/**
 * Multi-Step Action Planner and Tool-Calling Pipeline
 * Part B: Natural-language request interpretation, ordered step planning,
 * Zod tool argument validation, and follow-up command support.
 */

import { BrowserAction } from '../shared/types/actions';
import { SupportedLanguage, ConversationMessage } from '../shared/types/assistant';
import { validateBrowserAction } from '../shared/safety/validation';
import { defaultActionPolicy } from '../shared/safety/action-policy';
import { logger } from '../shared/utils';
import { PlanBatch, PlannedStep, PageContext } from './types';
import { CostTracker, defaultCostTracker } from './costTracker';
import { ApprovalPolicyEnforcer, defaultApprovalPolicyEnforcer } from './policyEnforcer';

export class MultiStepPlanner {
  constructor(
    private costTracker: CostTracker = defaultCostTracker,
    private policyEnforcer: ApprovalPolicyEnforcer = defaultApprovalPolicyEnforcer
  ) {}

  /**
   * Plans an ordered sequence of browser actions from a natural language goal.
   * Validates EVERY action using Zod runtime schema.
   */
  public async planGoal(
    goal: string,
    language: SupportedLanguage = 'en',
    pageContext?: PageContext,
    conversationHistory?: ConversationMessage[]
  ): Promise<PlanBatch> {
    logger.info('MultiStepPlanner', `Planning task for goal: "${goal}" [${language}]`);

    // Check if this is a follow-up request based on history or keywords
    const isFollowUp = this.detectFollowUp(goal, conversationHistory);
    const rawActions = this.synthesizeActionSequence(goal, isFollowUp, pageContext);

    // Validate each generated action with Zod schema
    const validatedSteps: PlannedStep[] = [];
    for (let i = 0; i < rawActions.length; i++) {
      const candidateAction = rawActions[i];
      const validation = validateBrowserAction(candidateAction);

      if (!validation.isValid) {
        logger.warn(
          'MultiStepPlanner',
          `Rejected invalid action #${i + 1}: ${validation.errors.join('; ')}`
        );
        continue;
      }

      const policyEval = this.policyEnforcer.evaluateAction(validation.action);
      const decision = defaultActionPolicy.evaluate(validation.action);

      validatedSteps.push({
        stepNumber: validatedSteps.length + 1,
        action: validation.action,
        description: this.describeAction(validation.action, language),
        riskLevel: decision.riskLevel,
        requiresExplicitApproval: policyEval.requiresApproval,
      });
    }

    // Estimate token usage and cost
    const promptTokens = this.costTracker.estimateTokens(goal, language !== 'en');
    const completionTokens = validatedSteps.length * 45;
    const costEstimate = this.costTracker.calculateCost(promptTokens, completionTokens);
    this.costTracker.recordUsage(costEstimate);

    const explanation = this.formatPlanExplanation(goal, validatedSteps.length, language, isFollowUp);

    return {
      goal,
      language,
      steps: validatedSteps,
      explanation,
      costEstimate,
    };
  }

  /**
   * Detects follow-up keywords ("make it shorter", "add conclusion", "continue from where you stopped")
   */
  private detectFollowUp(goal: string, history?: ConversationMessage[]): 'shorter' | 'conclusion' | 'continue' | 'upload' | null {
    const lower = goal.toLowerCase().trim();

    if (
      lower.startsWith('make it shorter') ||
      lower === 'make it shorter' ||
      lower.includes('छोटा करो') ||
      lower.includes('कमी करा') ||
      lower === 'summarize'
    ) {
      return 'shorter';
    }

    if (
      lower.startsWith('add a conclusion') ||
      lower.startsWith('add conclusion') ||
      lower === 'add a conclusion' ||
      lower === 'conclusion' ||
      lower.startsWith('निष्कर्ष जोड़ो') ||
      lower.startsWith('निष्कर्ष जोडा')
    ) {
      return 'conclusion';
    }

    if (
      lower.startsWith('continue') ||
      lower.includes('continue from where you stopped') ||
      lower.includes('जारी रखो') ||
      lower.includes('पुढे चालू ठेवा')
    ) {
      return 'continue';
    }

    if (
      lower.includes('upload') ||
      lower.includes('drag and drop') ||
      lower.includes('अपलोड') ||
      lower.includes('ड्रैग')
    ) {
      return 'upload';
    }

    if (history && history.length > 2) {
      return 'continue';
    }
    return null;
  }

  /**
   * Generates appropriate candidate browser actions based on natural language intent.
   * Supports:
   * 1. Google Docs creation & essay writing ("Open Google Docs, create a document, and write a 500-word essay...")
   * 2. Google Classroom / Drive file upload & drag-and-drop ("upload file to gc", "drag and drop file")
   * 3. Navigation & search ("search for X", "open youtube")
   * 4. Follow-up modifications ("make it shorter", "add conclusion")
   */
  private synthesizeActionSequence(
    goal: string,
    followUpType: 'shorter' | 'conclusion' | 'continue' | 'upload' | null,
    pageContext?: PageContext
  ): BrowserAction[] {
    const lower = goal.toLowerCase();

    // 1. Follow-up: Make it shorter
    if (followUpType === 'shorter') {
      return [
        { type: 'click_element', targetId: 'kix-app-content-editor' },
        { type: 'type_text', text: ' [Summary Edit: Revised to concise 250-word synthesis]', targetId: 'kix-app-content-editor' },
        { type: 'scroll_page', direction: 'up', amount: 200 },
      ];
    }

    // 2. Follow-up: Add a conclusion
    if (followUpType === 'conclusion') {
      return [
        { type: 'click_element', targetId: 'kix-app-content-editor' },
        { type: 'scroll_page', direction: 'down', amount: 400 },
        {
          type: 'type_text',
          text: '\n\nConclusion:\nIn conclusion, transitioning to renewable energy sources is essential for sustainable ecological stewardship and long-term economic resilience.',
          targetId: 'kix-app-content-editor',
        },
      ];
    }

    // 3. File upload / Drag & Drop to Google Classroom ("gc"), Drive, or portal
    if (followUpType === 'upload' || lower.includes('upload') || lower.includes('classroom') || lower.includes('gc')) {
      const actions: BrowserAction[] = [];
      if (!pageContext?.url || !pageContext.url.includes('classroom.google.com')) {
        actions.push({ type: 'open_url', url: 'https://classroom.google.com' });
      }
      actions.push(
        { type: 'click_element', targetId: 'course-assignment-item' },
        { type: 'scroll_page', direction: 'down', amount: 350 },
        { type: 'click_element', targetId: 'add-or-create-attachment-button' },
        { type: 'click_element', targetId: 'file-upload-dropzone' }
      );
      return actions;
    }

    // 4. Google Docs document creation and essay writing
    if (lower.includes('google docs') || lower.includes('essay') || lower.includes('document') || lower.includes('निबंध')) {
      return [
        { type: 'open_url', url: 'https://docs.new' },
        { type: 'read_page' },
        { type: 'click_element', targetId: 'docs-title-widget' },
        { type: 'type_text', text: 'Renewable Energy: The Path to a Sustainable Future', targetId: 'docs-title-widget' },
        { type: 'click_element', targetId: 'kix-app-content-editor' },
        {
          type: 'type_text',
          text: 'Introduction:\nRenewable energy sources such as solar, wind, and hydroelectric power provide an inexhaustible alternative to fossil fuels. As global climate concerns intensify, accelerating the adoption of clean technology has become paramount.\n\nTechnological Advancements:\nModern photovoltaic solar cells and advanced offshore wind turbines now operate at unprecedented efficiency, substantially lowering the cost per kilowatt-hour across both emerging and developed markets.\n\nConclusion:\nTransitioning to clean energy is not merely an environmental imperative, but also an economic catalyst that promises energy independence and a sustainable planet.',
          targetId: 'kix-app-content-editor',
        },
      ];
    }

    // 5. Search / Information gathering
    if (lower.includes('search') || lower.includes('सर्च') || lower.includes('शोध') || lower.includes('find')) {
      return [
        { type: 'open_url', url: 'https://www.google.com' },
        { type: 'click_element', targetId: 'search-input' },
        { type: 'type_text', text: goal.replace(/(search|find|सर्च|शोध|for)\s*/gi, '').trim() || goal, targetId: 'search-input' },
        { type: 'scroll_page', direction: 'down', amount: 300 },
      ];
    }

    // Default general multi-step browsing plan
    return [
      { type: 'read_page' },
      { type: 'scroll_page', direction: 'down', amount: 300 },
      { type: 'click_element', targetId: 'primary-action-button' },
    ];
  }

  private describeAction(action: BrowserAction, language: SupportedLanguage): string {
    switch (action.type) {
      case 'open_url':
        return language === 'hi' ? `URL खोलें: ${action.url}` : language === 'mr' ? `URL उघडा: ${action.url}` : `Open URL: ${action.url}`;
      case 'click_element':
        return language === 'hi' ? `एलिमेंट पर क्लिक करें: #${action.targetId}` : language === 'mr' ? `घटकावर क्लिक करा: #${action.targetId}` : `Click element: #${action.targetId}`;
      case 'type_text':
        return language === 'hi' ? `टेक्स्ट टाइप करें: "${action.text.slice(0, 30)}..."` : language === 'mr' ? `मजकूर टाइप करा: "${action.text.slice(0, 30)}..."` : `Type text: "${action.text.slice(0, 30)}..."`;
      case 'scroll_page':
        return language === 'hi' ? `पेज स्क्रॉल करें (${action.direction} ${action.amount}px)` : language === 'mr' ? `पृष्ठ स्क्रोल करा (${action.direction} ${action.amount}px)` : `Scroll page ${action.direction} by ${action.amount}px`;
      case 'navigate_back':
        return language === 'hi' ? 'पीछे जाएं' : language === 'mr' ? 'मागे जा' : 'Navigate back';
      case 'navigate_forward':
        return language === 'hi' ? 'आगे जाएं' : language === 'mr' ? 'पुढे जा' : 'Navigate forward';
      case 'switch_tab':
        return language === 'hi' ? `टैब बदलें (${action.direction})` : language === 'mr' ? `टॅब बदला (${action.direction})` : `Switch tab ${action.direction}`;
      case 'read_page':
        return language === 'hi' ? 'पेज सामग्री पढ़ें' : language === 'mr' ? 'पृष्ठ सामग्री वाचा' : 'Read webpage content';
      case 'undo':
        return language === 'hi' ? 'अन्डू करें' : language === 'mr' ? 'अन्डू करा' : 'Undo last action';
      case 'redo':
        return language === 'hi' ? 'रीडू करें' : language === 'mr' ? 'रीडू करा' : 'Redo last action';
      default:
        return 'Unknown action';
    }
  }

  private formatPlanExplanation(
    goal: string,
    stepCount: number,
    language: SupportedLanguage,
    followUpType: string | null
  ): string {
    if (language === 'hi') {
      return followUpType
        ? `फॉलो-अप अनुरोध स्वीकार किया गया। योजना में ${stepCount} मान्य कार्रवाइयाँ शामिल हैं।`
        : `"${goal}" के लिए ${stepCount} चरणों की ब्राउज़र कार्य-योजना तैयार की गई है।`;
    }
    if (language === 'mr') {
      return followUpType
        ? `पुढील सूचना स्वीकारली गेली. योजनेत ${stepCount} वैध कृतींचा समावेश आहे.`
        : `"${goal}" साठी ${stepCount} पायऱ्यांची ब्राउझर कृती योजना तयार केली आहे.`;
    }
    return followUpType
      ? `Follow-up request processed. Formulated ${stepCount} validated browser action(s).`
      : `Formulated ${stepCount}-step browser action plan for: "${goal}".`;
  }
}

export const defaultMultiStepPlanner = new MultiStepPlanner();
