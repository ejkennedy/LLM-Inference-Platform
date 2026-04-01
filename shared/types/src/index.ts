export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type UserTier = 'free' | 'standard' | 'pro';

export type TransportMode = 'stream' | 'json';

export type AuthClaims = {
  sub: string;
  tier: UserTier;
  budgetLimitCents: number;
  tenantId: string;
  role?: 'user' | 'admin';
  scopes?: string[];
  iss?: string;
  aud?: string | string[];
  jti?: string;
  iat?: number;
  exp?: number;
  nbf?: number;
};

export type GatewayRequest = {
  messages: ChatMessage[];
  model?: string | null;
  requestId?: string | null;
  maxTokens?: number;
  stream?: boolean;
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

export type RateLimitCheckResponse = {
  allow: boolean;
  reason: 'allowed' | 'rate_limit' | 'budget';
  remaining: number;
  retryAfterSeconds?: number;
  window: {
    type: 'minute';
    bucket: number;
  };
};

export type BudgetState = {
  budgetLimitCents: number;
  estimatedSpendCents: number;
  remainingBudgetCents: number;
};

export type UsageSummary = BudgetState & {
  requestCountCurrentMinute: number;
  currentMinuteBucket: number;
};

export type BillingLedgerEntry = {
  type: 'reservation' | 'reconciliation' | 'release';
  requestId: string;
  ts: string;
  estimatedCostCents: number;
  actualCostCents?: number;
  deltaCostCents: number;
  remainingBudgetCents: number;
};

export type AdminUsageResponse = UsageSummary & {
  userId: string;
  activeReservations: number;
  recentLedger: BillingLedgerEntry[];
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

export type ObservabilityEvent = {
  requestId: string;
  userId?: string;
  model: string;
  promptTokens: number;
  completionTokens?: number;
  costCents: number;
};

export type RateLimitCheckRequest = {
  requestId: string;
  userId: string;
  budgetLimitCents: number;
  estimatedCostCents: number;
  requestLimitPerMinute?: number;
  reservationTtlSeconds?: number;
};

export type SpendRequest = {
  requestId: string;
  estimatedCostCents: number;
  actualCostCents?: number;
};
