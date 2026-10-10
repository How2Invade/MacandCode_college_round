export interface AiCompletionRequest {
  prompt: string;
  language: 'en' | 'hi' | 'mr';
  pageContext?: {
    url?: string;
    title?: string;
    domSummary?: string;
  };
}

export interface AiCompletionResponse {
  reply: string;
  actions: Array<{
    type: string;
    params: Record<string, unknown>;
    description: string;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
  }>;
}
