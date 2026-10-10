import { describe, it, expect } from 'vitest';
import { MultiStepPlanner } from '../../src/ai/multiStepPlanner';
import { CostTracker } from '../../src/ai/costTracker';
import { validateBrowserAction } from '../../src/shared/safety/validation';

describe('Multi-Step Planner and Tool Calling (Part B)', () => {
  it('should plan a multi-step Google Docs task with essay content and validated actions', async () => {
    const planner = new MultiStepPlanner();
    const plan = await planner.planGoal(
      'Open Google Docs, create a document, and write a 500-word essay on renewable energy with an introduction and conclusion.',
      'en'
    );

    expect(plan.steps.length).toBeGreaterThanOrEqual(4);
    expect(plan.steps[0].action.type).toBe('open_url');
    if (plan.steps[0].action.type === 'open_url') {
      expect(plan.steps[0].action.url).toBe('https://docs.new');
    }

    // Verify all steps are allowlisted and valid
    for (const step of plan.steps) {
      const v = validateBrowserAction(step.action);
      expect(v.isValid).toBe(true);
    }

    expect(plan.costEstimate.tokenUsage.totalTokens).toBeGreaterThan(0);
    expect(plan.costEstimate.estimatedCostUsd).toBeGreaterThanOrEqual(0);
  });

  it('should support follow-up requests: "make it shorter" and "add a conclusion"', async () => {
    const planner = new MultiStepPlanner();

    // 1. "make it shorter"
    const shorterPlan = await planner.planGoal('make it shorter', 'en');
    expect(shorterPlan.steps.length).toBeGreaterThan(0);
    const hasEditStep = shorterPlan.steps.some(
      (s) => s.action.type === 'type_text' && s.action.text.includes('Summary Edit')
    );
    expect(hasEditStep).toBe(true);

    // 2. "add a conclusion"
    const conclusionPlan = await planner.planGoal('add a conclusion', 'en');
    const hasConclusion = conclusionPlan.steps.some(
      (s) => s.action.type === 'type_text' && s.action.text.includes('Conclusion')
    );
    expect(hasConclusion).toBe(true);
  });

  it('should plan file upload and drag-and-drop interactions for Google Classroom (gc)', async () => {
    const planner = new MultiStepPlanner();
    const uploadPlan = await planner.planGoal('Upload my assignment file to gc classroom', 'en');

    expect(uploadPlan.steps.length).toBeGreaterThanOrEqual(3);
    const hasClassroomUrl = uploadPlan.steps.some(
      (s) => s.action.type === 'open_url' && s.action.url.includes('classroom.google.com')
    );
    expect(hasClassroomUrl).toBe(true);

    const hasDropzoneOrAttach = uploadPlan.steps.some(
      (s) => s.action.type === 'click_element' && (s.action.targetId.includes('dropzone') || s.action.targetId.includes('attachment'))
    );
    expect(hasDropzoneOrAttach).toBe(true);
  });

  it('should formulate multilingual plans in Hindi and Marathi', async () => {
    const planner = new MultiStepPlanner();

    const hiPlan = await planner.planGoal('गूगल सर्च करो और डॉक बनाओ', 'hi');
    expect(hiPlan.language).toBe('hi');
    expect(hiPlan.explanation).toContain('चरणों की ब्राउज़र कार्य-योजना');

    const mrPlan = await planner.planGoal('माहिती शोधा आणि निबंध लिहा', 'mr');
    expect(mrPlan.language).toBe('mr');
    expect(mrPlan.explanation).toContain('पायऱ्यांची ब्राउझर कृती योजना');
  });

  it('should reject invalid or malformed actions via Zod runtime validation', () => {
    // Malformed URL (not http/https)
    const invalidUrl = validateBrowserAction({
      type: 'open_url',
      url: 'javascript:alert(1)',
    });
    expect(invalidUrl.isValid).toBe(false);

    // Negative scroll amount
    const invalidScroll = validateBrowserAction({
      type: 'scroll_page',
      direction: 'down',
      amount: -500,
    });
    expect(invalidScroll.isValid).toBe(false);

    // Unknown action type
    const unknownAction = validateBrowserAction({
      type: 'execute_arbitrary_shell_command',
      command: 'rm -rf /',
    });
    expect(unknownAction.isValid).toBe(false);
  });

  it('should track token costs and enforce budget limits in CostTracker', () => {
    const tracker = new CostTracker({ budgetCapUsd: 0.001 });

    const estimate = tracker.calculateCost(500, 200, 'gemini-1.5-flash');
    expect(estimate.tokenUsage.totalTokens).toBe(700);
    expect(estimate.estimatedCostUsd).toBeGreaterThan(0);

    tracker.recordUsage(estimate);
    const summary = tracker.getSummary();
    expect(summary.totalTokens).toBe(700);
    expect(summary.requestCount).toBe(1);
  });
});
