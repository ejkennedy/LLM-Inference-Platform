export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type GatewayRequest = {
  messages: ChatMessage[];
  model?: string;
  requestId?: string;
};

export type GatewayResponse = {
  requestId?: string;
  status: 'ok' | 'error';
  message?: string;
};

export type RouterRequest = {
  userTier: 'free' | 'standard' | 'pro';
  budgetRemainingCents: number;
  requestedModel: string;
  promptTokensEstimate: number;
};

export type RouterResponse = {
  resolvedModel: string;
  cfModelId: string;
  expectedCostCents: number;
  via: 'workers-ai' | 'external';
  reason?: string;
};
