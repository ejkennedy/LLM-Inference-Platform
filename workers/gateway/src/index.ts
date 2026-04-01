import type {
  AdminUsageResponse,
  BillingLedgerEntry,
  BudgetState,
  GatewayRequest,
  HealthResponse,
  ObservabilityEvent,
  RateLimitCheckRequest,
  RateLimitCheckResponse,
  RouterRequest,
  RouterResponse,
  SpendRequest,
  UsageSummary
} from "@llm-inference-platform/types";
import {
  authenticateRequest,
  estimatePromptTokens,
  estimateTextTokens,
  requireAdminClaims,
  type AuthConfig
} from "./auth";
import { buildProviderAllowlist, runInference } from "./provider";
import {
  normalizeIterableAiStream,
  normalizeReadableAiStream
} from "./sse";

export interface Env {
  AI?: Ai;
  MODEL_CATALOGUE: KVNamespace;
  ROUTER: Fetcher;
  OBSERVABILITY: Fetcher;
  RATE_LIMITER: DurableObjectNamespace;
  JWT_SECRET?: string;
  JWT_SECRET_PREVIOUS?: string;
  JWT_SECRET_NEXT?: string;
  JWT_JWKS_URL?: string;
  JWT_ISSUER?: string;
  JWT_AUDIENCE?: string;
  JWT_CLOCK_SKEW_SECONDS?: string;
  JWT_JWKS_CACHE_TTL_SECONDS?: string;
  AI_GATEWAY_ID?: string;
  AI_GATEWAY_SKIP_CACHE?: string;
  AI_GATEWAY_CACHE_TTL?: string;
  EXTERNAL_PROVIDER_ENABLED?: string;
  EXTERNAL_PROVIDER_BASE_URL?: string;
  EXTERNAL_PROVIDER_API_KEY?: string;
  EXTERNAL_PROVIDER_PATH?: string;
  EXTERNAL_PROVIDER_MODEL_PREFIX?: string;
  EXTERNAL_PROVIDER_MAX_RETRIES?: string;
  EXTERNAL_PROVIDER_RETRY_BASE_MS?: string;
  EXTERNAL_PROVIDER_TIMEOUT_MS?: string;
  EXTERNAL_PROVIDER_CIRCUIT_FAILURE_THRESHOLD?: string;
  EXTERNAL_PROVIDER_CIRCUIT_COOLDOWN_SECONDS?: string;
  RATE_LIMIT_REQUESTS_PER_MINUTE?: string;
  RATE_LIMIT_RESERVATION_TTL_SECONDS?: string;
  BILLING_LEDGER_LIMIT?: string;
}

type AiStreamChunk =
  | string
  | {
      response?: string;
      done?: boolean;
      error?: string;
    };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Request-Id"
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders
        });
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return json<HealthResponse>({
          status: "ok",
          service: "gateway",
          ts: new Date().toISOString()
        });
      }

      if (request.method === "GET" && url.pathname === "/v1/usage") {
        const claims = await authenticateRequest(request, authConfig(env));
        const usage = await getUsageSummary(env, claims.sub);
        return withCors(json(usage));
      }

      if (request.method === "GET" && url.pathname === "/v1/admin/usage") {
        const claims = await authenticateRequest(request, authConfig(env));
        requireAdminClaims(claims);
        const userId = url.searchParams.get("userId");
        if (!userId) {
          return withCors(json({ status: "error", message: "userId is required" }, { status: 400 }));
        }
        const limit = parsePositiveInt(
          url.searchParams.get("limit"),
          parsePositiveInt(env.BILLING_LEDGER_LIMIT, 20)
        );
        const usage = await getAdminUsageSummary(env, userId, limit);
        return withCors(json(usage));
      }

      if (request.method !== "POST" || url.pathname !== "/v1/chat") {
        return withCors(new Response("Not Found", { status: 404 }));
      }

      const claims = await authenticateRequest(request, authConfig(env));
      const currentUsage = await getUsageSummary(env, claims.sub);
      const payload = (await request.json()) as GatewayRequest;
      const requestId = payload.requestId ?? request.headers.get("X-Request-Id") ?? crypto.randomUUID();
      const messages = payload.messages ?? [];
      const promptTokensEstimate = estimatePromptTokens(messages);

      if (messages.length === 0) {
        return withCors(
          json(
            {
              requestId,
              status: "error",
              message: "messages must contain at least one chat message"
            },
            { status: 400 }
          ),
          requestId
        );
      }

      const routing = await resolveRoute(env, {
        requestId,
        userTier: claims.tier,
        budgetRemainingCents: currentUsage.remainingBudgetCents || claims.budgetLimitCents,
        requestedModel: payload.model,
        promptTokensEstimate,
        maxOutputTokens: payload.maxTokens ?? 512,
        providerAllowlist: buildProviderAllowlist(env)
      });

      const rateLimit = await checkRateLimit(env, {
        requestId,
        userId: claims.sub,
        budgetLimitCents: claims.budgetLimitCents,
        estimatedCostCents: routing.expectedCostCents,
        requestLimitPerMinute: parsePositiveInt(env.RATE_LIMIT_REQUESTS_PER_MINUTE, 60),
        reservationTtlSeconds: parsePositiveInt(env.RATE_LIMIT_RESERVATION_TTL_SECONDS, 900)
      });

      if (!rateLimit.allow) {
        return withCors(
          json(
            {
              requestId,
              status: "error",
              message: rateLimit.reason === "budget" ? "budget exceeded" : "rate limit exceeded"
            },
            {
              status: rateLimit.reason === "budget" ? 402 : 429,
              headers: rateLimit.retryAfterSeconds
                ? { "Retry-After": String(rateLimit.retryAfterSeconds) }
                : undefined
            }
          ),
          requestId
        );
      }

      ctx.waitUntil(
        publishObservation(env, {
          requestId,
          userId: claims.sub,
          model: routing.resolvedModel,
          promptTokens: promptTokensEstimate,
          costCents: routing.expectedCostCents
        })
      );

      const streamEnabled = payload.stream ?? true;
      const upstream = await runInference(
        env,
        routing,
        messages,
        streamEnabled,
        payload.maxTokens ?? 512,
        requestId
      );

      if (streamEnabled) {
        if (upstream instanceof ReadableStream) {
          const response = await normalizeReadableAiStream(upstream, requestId, routing);
          ctx.waitUntil(
            recordSpend(env, claims.sub, {
              requestId,
              estimatedCostCents: routing.expectedCostCents
            })
          );

          return withCors(response, requestId);
        }

        if (!isAsyncIterable(upstream)) {
          return withCors(
            json(
              {
                requestId,
                status: "error",
              message: "provider returned an unsupported streaming response"
              },
              { status: 502 }
            ),
            requestId
          );
        }

        const response = await normalizeIterableAiStream(upstream, requestId, routing);
        ctx.waitUntil(
          recordSpend(env, claims.sub, {
            requestId,
            estimatedCostCents: routing.expectedCostCents
          })
        );

        return withCors(response, requestId);
      }

      const completion = normalizeJsonCompletion(upstream, requestId, routing);
      ctx.waitUntil(
        Promise.all([
          recordSpend(env, claims.sub, {
            requestId,
            estimatedCostCents: routing.expectedCostCents,
            actualCostCents: routing.expectedCostCents
          }),
          publishObservation(env, {
            requestId,
            userId: claims.sub,
            model: routing.resolvedModel,
            promptTokens: promptTokensEstimate,
            completionTokens: estimateTextTokens(completion.outputText),
            costCents: routing.expectedCostCents
          })
        ])
      );

      return withCors(json(completion), requestId);
    } catch (error) {
      if (error instanceof Response) {
        return withCors(error);
      }

      console.error("Gateway request failed", error);
      return withCors(
        json(
          {
            status: "error",
            message: "internal gateway error"
          },
          { status: 500 }
        )
      );
    }
  }
};

export class RateLimiter {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/check") {
      const payload = (await request.json()) as RateLimitCheckRequest;
      return this.handleCheck(payload);
    }

    if (request.method === "POST" && url.pathname === "/spend") {
      const payload = (await request.json()) as SpendRequest;
      return this.handleSpend(payload);
    }

    if (request.method === "GET" && url.pathname === "/balance") {
      return json(await this.readUsageSummary());
    }

    if (request.method === "GET" && url.pathname === "/admin/usage") {
      const limit = parsePositiveInt(url.searchParams.get("limit"), 20);
      return json(await this.readAdminUsage(limit));
    }

    return new Response("Not Found", { status: 404 });
  }

  private async handleCheck(payload: RateLimitCheckRequest): Promise<Response> {
    await this.cleanupState(payload.reservationTtlSeconds);

    const now = Date.now();
    const minuteBucket = Math.floor(now / 60_000);
    const requestKey = `rpm:${minuteBucket}`;
    const limit = payload.requestLimitPerMinute ?? 60;
    const budgetState = (await this.state.storage.get<BudgetState>("budget")) ?? {
      budgetLimitCents: payload.budgetLimitCents,
      estimatedSpendCents: 0,
      remainingBudgetCents: payload.budgetLimitCents
    };

    const count = ((await this.state.storage.get<number>(requestKey)) ?? 0) + 1;
    const nextEstimatedSpend = Number(
      (budgetState.estimatedSpendCents + payload.estimatedCostCents).toFixed(4)
    );
    const nextRemainingBudget = Number(
      (payload.budgetLimitCents - nextEstimatedSpend).toFixed(4)
    );

    const allow = count <= limit && nextRemainingBudget >= 0;
    if (allow) {
      await this.state.storage.put("userId", payload.userId);
      await this.state.storage.put(requestKey, count);
      await this.state.storage.put("budget", {
        budgetLimitCents: payload.budgetLimitCents,
        estimatedSpendCents: nextEstimatedSpend,
        remainingBudgetCents: nextRemainingBudget
      } satisfies BudgetState);
      await this.state.storage.put(`request:${payload.requestId}`, {
        estimatedCostCents: payload.estimatedCostCents,
        createdAt: now
      });
      await this.appendLedgerEntry({
        type: "reservation",
        requestId: payload.requestId,
        ts: new Date(now).toISOString(),
        estimatedCostCents: payload.estimatedCostCents,
        deltaCostCents: payload.estimatedCostCents,
        remainingBudgetCents: nextRemainingBudget
      });
    }

    return json<RateLimitCheckResponse>({
      allow,
      reason: allow ? "allowed" : count > limit ? "rate_limit" : "budget",
      remaining: allow ? Math.max(limit - count, 0) : Math.max(nextRemainingBudget, 0),
      retryAfterSeconds: count > limit ? 60 - Math.floor((now % 60_000) / 1_000) : undefined,
      window: {
        type: "minute",
        bucket: minuteBucket
      }
    });
  }

  private async handleSpend(payload: SpendRequest): Promise<Response> {
    await this.cleanupState();

    const budgetState = (await this.state.storage.get<BudgetState>("budget")) ?? {
      budgetLimitCents: 0,
      estimatedSpendCents: 0,
      remainingBudgetCents: 0
    };
    const reservation =
      (await this.state.storage.get<{ estimatedCostCents: number; createdAt: number }>(
        `request:${payload.requestId}`
      )) ?? undefined;
    const reserved = reservation?.estimatedCostCents ?? payload.estimatedCostCents;
    const actual = payload.actualCostCents ?? payload.estimatedCostCents;
    const adjustedSpend = Number(
      Math.max(budgetState.estimatedSpendCents - reserved + actual, 0).toFixed(4)
    );
    const remainingBudgetCents = Number(
      Math.max(budgetState.budgetLimitCents - adjustedSpend, 0).toFixed(4)
    );

    await this.state.storage.put("budget", {
      budgetLimitCents: budgetState.budgetLimitCents,
      estimatedSpendCents: adjustedSpend,
      remainingBudgetCents
    } satisfies BudgetState);
    await this.state.storage.delete(`request:${payload.requestId}`);
    await this.appendLedgerEntry({
      type: "reconciliation",
      requestId: payload.requestId,
      ts: new Date().toISOString(),
      estimatedCostCents: reserved,
      actualCostCents: actual,
      deltaCostCents: Number((actual - reserved).toFixed(4)),
      remainingBudgetCents
    });

    return json(await this.readUsageSummary());
  }

  private async readUsageSummary(): Promise<UsageSummary> {
    await this.cleanupState();
    const minuteBucket = Math.floor(Date.now() / 60_000);
    const requestCountCurrentMinute =
      (await this.state.storage.get<number>(`rpm:${minuteBucket}`)) ?? 0;
    const budget = (await this.state.storage.get<BudgetState>("budget")) ?? {
      budgetLimitCents: 0,
      estimatedSpendCents: 0,
      remainingBudgetCents: 0
    };

    return {
      ...budget,
      requestCountCurrentMinute,
      currentMinuteBucket: minuteBucket
    };
  }

  private async readAdminUsage(limit: number): Promise<AdminUsageResponse> {
    const summary = await this.readUsageSummary();
    const recentLedger = await this.readRecentLedger(limit);
    const activeReservations = (await this.state.storage.list({ prefix: "request:" })).size;
    const userId = (await this.state.storage.get<string>("userId")) ?? "unknown";

    return {
      userId,
      ...summary,
      activeReservations,
      recentLedger
    };
  }

  private async cleanupState(reservationTtlSeconds = 900): Promise<void> {
    const now = Date.now();
    const reservationCutoff = now - reservationTtlSeconds * 1000;
    const requests = await this.state.storage.list<{ estimatedCostCents: number; createdAt: number }>({
      prefix: "request:"
    });
    const budgetState = (await this.state.storage.get<BudgetState>("budget")) ?? {
      budgetLimitCents: 0,
      estimatedSpendCents: 0,
      remainingBudgetCents: 0
    };

    let spendReduction = 0;
    for (const [key, reservation] of requests) {
      if (reservation.createdAt >= reservationCutoff) {
        continue;
      }
      spendReduction += reservation.estimatedCostCents;
      await this.state.storage.delete(key);
      await this.appendLedgerEntry({
        type: "release",
        requestId: key.slice("request:".length),
        ts: new Date(now).toISOString(),
        estimatedCostCents: reservation.estimatedCostCents,
        deltaCostCents: Number((-reservation.estimatedCostCents).toFixed(4)),
        remainingBudgetCents: Number(
          Math.max(
            budgetState.budgetLimitCents - Math.max(budgetState.estimatedSpendCents - spendReduction, 0),
            0
          ).toFixed(4)
        )
      });
    }

    if (spendReduction > 0) {
      const adjustedSpend = Number(Math.max(budgetState.estimatedSpendCents - spendReduction, 0).toFixed(4));
      await this.state.storage.put("budget", {
        budgetLimitCents: budgetState.budgetLimitCents,
        estimatedSpendCents: adjustedSpend,
        remainingBudgetCents: Number(
          Math.max(budgetState.budgetLimitCents - adjustedSpend, 0).toFixed(4)
        )
      } satisfies BudgetState);
    }

    const currentMinuteBucket = Math.floor(now / 60_000);
    const buckets = await this.state.storage.list<number>({ prefix: "rpm:" });
    for (const [key] of buckets) {
      const bucket = Number(key.slice("rpm:".length));
      if (Number.isFinite(bucket) && bucket < currentMinuteBucket - 5) {
        await this.state.storage.delete(key);
      }
    }
  }

  private async appendLedgerEntry(entry: BillingLedgerEntry): Promise<void> {
    const ledger = await this.readRecentLedger(199);
    ledger.unshift(entry);
    await this.state.storage.put("ledger", ledger.slice(0, 200));
  }

  private async readRecentLedger(limit: number): Promise<BillingLedgerEntry[]> {
    const ledger = (await this.state.storage.get<BillingLedgerEntry[]>("ledger")) ?? [];
    return ledger.slice(0, Math.max(limit, 0));
  }
}

async function resolveRoute(env: Env, payload: RouterRequest): Promise<RouterResponse> {
  const response = await env.ROUTER.fetch(
    new Request("https://router.internal/route", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })
  );

  if (!response.ok) {
    throw new Error(`Router failed with status ${response.status}`);
  }

  return (await response.json()) as RouterResponse;
}

async function checkRateLimit(
  env: Env,
  payload: RateLimitCheckRequest
): Promise<RateLimitCheckResponse> {
  const id = env.RATE_LIMITER.idFromName(payload.userId);
  const response = await env.RATE_LIMITER.get(id).fetch("https://rate-limiter.internal/check", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Rate limiter failed with status ${response.status}`);
  }

  return (await response.json()) as RateLimitCheckResponse;
}

async function recordSpend(env: Env, userId: string, payload: SpendRequest): Promise<void> {
  const id = env.RATE_LIMITER.idFromName(userId);
  const response = await env.RATE_LIMITER.get(id).fetch("https://rate-limiter.internal/spend", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Rate limiter spend update failed with status ${response.status}`);
  }
}

async function getUsageSummary(env: Env, userId: string): Promise<UsageSummary> {
  const id = env.RATE_LIMITER.idFromName(userId);
  const response = await env.RATE_LIMITER.get(id).fetch("https://rate-limiter.internal/balance");

  if (!response.ok) {
    throw new Error(`Rate limiter balance lookup failed with status ${response.status}`);
  }

  return (await response.json()) as UsageSummary;
}

async function getAdminUsageSummary(
  env: Env,
  userId: string,
  limit: number
): Promise<AdminUsageResponse> {
  const id = env.RATE_LIMITER.idFromName(userId);
  const response = await env.RATE_LIMITER
    .get(id)
    .fetch(`https://rate-limiter.internal/admin/usage?limit=${limit}`);

  if (!response.ok) {
    throw new Error(`Rate limiter admin usage lookup failed with status ${response.status}`);
  }

  return (await response.json()) as AdminUsageResponse;
}

async function publishObservation(env: Env, event: ObservabilityEvent): Promise<void> {
  const response = await env.OBSERVABILITY.fetch("https://observability.internal/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(event)
  });

  if (!response.ok) {
    throw new Error(`Observability worker failed with status ${response.status}`);
  }
}

function normalizeJsonCompletion(
  response: unknown,
  requestId: string,
  routing: RouterResponse
): {
  requestId: string;
  model: string;
  outputText: string;
} {
  if (typeof response === "string") {
    return {
      requestId,
      model: routing.resolvedModel,
      outputText: response
    };
  }

  if (!response || typeof response !== "object") {
    throw errorResponse("Workers AI returned an unsupported JSON response", 502);
  }

  const candidate = response as { response?: string };
  return {
    requestId,
    model: routing.resolvedModel,
    outputText: candidate.response ?? JSON.stringify(response)
  };
}

function isAsyncIterable(
  value: unknown
): value is AsyncIterable<string | { response?: string | null; done?: boolean; error?: string; usage?: Record<string, unknown> }> {
  return Boolean(value) && typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function";
}

function withCors(response: Response, requestId?: string): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  if (requestId) {
    headers.set("X-Request-Id", requestId);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function json<T>(value: T, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value, null, 2), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
  });
}

function errorResponse(message: string, status: number): Response {
  return json({ status: "error", message }, { status });
}

function authConfig(env: Env): AuthConfig {
  return {
    jwtSecret: env.JWT_SECRET,
    jwtSecretPrevious: env.JWT_SECRET_PREVIOUS,
    jwtSecretNext: env.JWT_SECRET_NEXT,
    jwtJwksUrl: env.JWT_JWKS_URL,
    jwtIssuer: env.JWT_ISSUER,
    jwtAudience: env.JWT_AUDIENCE,
    jwtClockSkewSeconds: env.JWT_CLOCK_SKEW_SECONDS,
    jwtJwksCacheTtlSeconds: env.JWT_JWKS_CACHE_TTL_SECONDS
  };
}

function parsePositiveInt(value: string | null | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
