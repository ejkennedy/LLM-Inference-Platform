export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type UserTier = 'free' | 'standard' | 'pro';

export type TransportMode = 'stream' | 'json';

export type GatewayRequest = {
  messages: ChatMessage[];
  model?: string | null;
  requestId?: string;
  maxTokens?: number;
  stream?: boolean;
  userTier?: UserTier;
  budgetRemainingCents?: number;
};

export type GatewayResponse = {
  requestId: string;
  status: 'ok' | 'error';
  message?: string;
};

export type HealthResponse = {
  status: 'ok';
  service: 'gateway' | 'router' | 'observability';
  ts: string;
};

export type RouterRequest = {
  requestId?: string;
  userTier: UserTier;
  budgetRemainingCents: number;
  requestedModel?: string | null;
  promptTokensEstimate: number;
  maxOutputTokens?: number;
  providerAllowlist?: Array<'workers-ai' | 'external'>;
};

export type RouterResponse = {
  resolvedModel: string;
  cfModelId: string;
  expectedCostCents: number;
  via: 'workers-ai' | 'external';
  reason: string;
  policyVersion: string;
};

export type ModelCatalogueEntry = {
  id: string;
  provider: 'workers-ai' | 'external';
  cfModelId: string;
  inputCostPerMtok: number;
  outputCostPerMtok: number;
  maxContextTokens: number;
  enabled: boolean;
  tier: 'fast' | 'balanced' | 'premium';
  fallbackTo?: string;
};
