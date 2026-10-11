/**
 * LiveKit Conversational AI Agent Coordinator
 * Connects LiveKit real-time voice sessions to intelligent multi-turn reasoning and browser action generation.
 * Supports English, Hindi, and Marathi with strict Zod validation and allowlisted browser action schemas.
 */

import { LivekitAgentChatRequest, LivekitAgentChatResponse } from './types';
import { processChatRequest } from '../providers';
import { AiCompletionRequest } from '../types';

export class LivekitVoiceAgent {
  public async handleSpeechInput(
    request: LivekitAgentChatRequest
  ): Promise<LivekitAgentChatResponse> {
    const { prompt, language = 'en', history = [], pageContext } = request;

    // Adapt to standard backend completion request
    const completionRequest: AiCompletionRequest = {
      prompt,
      language,
      history,
      pageContext,
    };

    // Process through real-time conversational provider
    const completionResponse = await processChatRequest(completionRequest);

    return {
      reply: completionResponse.reply,
      actions: completionResponse.actions || [],
      language,
      costEstimate: completionResponse.costEstimate,
    };
  }
}

export const defaultLivekitVoiceAgent = new LivekitVoiceAgent();
