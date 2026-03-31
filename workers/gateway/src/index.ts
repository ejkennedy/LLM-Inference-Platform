import type {
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
  estimateTextTokens
} from "./auth";
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
        const claims = await authenticateRequest(request, env.JWT_SECRET);
        const usage = await getUsageSummary(env, claims.sub);
        return withCors(json(usage));
      }

      if (request.method !== "POST" || url.pathname !== "/v1/chat") {
        return withCors(new Response("Not Found", { status: 404 }));
      }

      const claims = await authenticateRequest(request, env.JWT_SECRET);
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
        providerAllowlist: ["workers-ai"]
      });

      const rateLimit = await checkRateLimit(env, {
        requestId,
        userId: claims.sub,
        budgetLimitCents: claims.budgetLimitCents,
        estimatedCostCents: routing.expectedCostCents
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

      if (routing.via !== "workers-ai") {
        return withCors(
          json(
            {
              requestId,
              status: "error",
              message: "external provider fallback is not enabled in this slice"
            },
            { status: 501 }
          ),
          requestId
        );
      }

      const streamEnabled = payload.stream ?? true;
      const upstream = env.AI
        ? await env.AI.run(routing.cfModelId as keyof AiModels, {
            messages,
            stream: streamEnabled,
            max_tokens: payload.maxTokens ?? 512
          })
        : createMockAiResponse(messages, streamEnabled);

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
                message: "Workers AI returned an unsupported streaming response"
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

    return new Response("Not Found", { status: 404 });
  }

  private async handleCheck(payload: RateLimitCheckRequest): Promise<Response> {
    const now = Date.now();
    const minuteBucket = Math.floor(now / 60_000);
    const requestKey = `rpm:${minuteBucket}`;
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

    const allow = count <= 60 && nextRemainingBudget >= 0;
    if (allow) {
      await this.state.storage.put(requestKey, count);
      await this.state.storage.put("budget", {
        budgetLimitCents: payload.budgetLimitCents,
        estimatedSpendCents: nextEstimatedSpend,
        remainingBudgetCents: nextRemainingBudget
      } satisfies BudgetState);
      await this.state.storage.put(`request:${payload.requestId}`, payload.estimatedCostCents);
    }

    return json<RateLimitCheckResponse>({
      allow,
      reason: allow ? "allowed" : count > 60 ? "rate_limit" : "budget",
      remaining: allow ? Math.max(60 - count, 0) : Math.max(nextRemainingBudget, 0),
      retryAfterSeconds: count > 60 ? 60 - Math.floor((now % 60_000) / 1_000) : undefined,
      window: {
        type: "minute",
        bucket: minuteBucket
      }
    });
  }

  private async handleSpend(payload: SpendRequest): Promise<Response> {
    const budgetState = (await this.state.storage.get<BudgetState>("budget")) ?? {
      budgetLimitCents: 0,
      estimatedSpendCents: 0,
      remainingBudgetCents: 0
    };
    const reserved = (await this.state.storage.get<number>(`request:${payload.requestId}`)) ?? payload.estimatedCostCents;
    const actual = payload.actualCostCents ?? payload.estimatedCostCents;
    const adjustedSpend = Number(
      Math.max(budgetState.estimatedSpendCents - reserved + actual, 0).toFixed(4)
    );

    await this.state.storage.put("budget", {
      budgetLimitCents: budgetState.budgetLimitCents,
      estimatedSpendCents: adjustedSpend,
      remainingBudgetCents: Number(
        Math.max(budgetState.budgetLimitCents - adjustedSpend, 0).toFixed(4)
      )
    } satisfies BudgetState);
    await this.state.storage.delete(`request:${payload.requestId}`);

    return json(await this.readUsageSummary());
  }

  private async readUsageSummary(): Promise<UsageSummary> {
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

function createMockAiResponse(
  messages: Array<{ content: string }>,
  streamEnabled: boolean
): AsyncIterable<AiStreamChunk> | { response: string } {
  const lastMessage = messages.at(-1)?.content ?? "No prompt provided.";
  const mockText = `Local gateway dev mode: Workers AI binding is unavailable, so this is a mock response to "${lastMessage}".`;

  if (!streamEnabled) {
    return { response: mockText };
  }

  return {
    async *[Symbol.asyncIterator]() {
      yield { response: mockText, done: true };
    }
  };
}

function sseHeaders(requestId: string, routing: RouterResponse): HeadersInit {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Request-Id": requestId,
    "X-Resolved-Model": routing.resolvedModel,
    ...corsHeaders
  };
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
