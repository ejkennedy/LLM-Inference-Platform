import type { ChatMessage, RouterResponse } from "@llm-inference-platform/types";

export type GatewayAiOptions = {
  gateway?: {
    id: string;
    skipCache?: boolean;
    cacheTtl?: number;
  };
};

export type ProviderEnv = {
  AI?: Ai;
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
};

type ProviderStreamChunk = {
  response?: string;
  done?: boolean;
  error?: string;
  usage?: Record<string, unknown>;
};

type CircuitState = {
  failures: number;
  openUntil?: number;
};

const providerCircuitState = new Map<string, CircuitState>();

export function buildAiRunOptions(env: {
  AI_GATEWAY_ID?: string;
  AI_GATEWAY_SKIP_CACHE?: string;
  AI_GATEWAY_CACHE_TTL?: string;
}): GatewayAiOptions | undefined {
  if (!env.AI_GATEWAY_ID) {
    return undefined;
  }

  const gateway: NonNullable<GatewayAiOptions["gateway"]> = {
    id: env.AI_GATEWAY_ID
  };

  const options: GatewayAiOptions = {
    gateway
  };

  if (env.AI_GATEWAY_SKIP_CACHE === "true") {
    gateway.skipCache = true;
  }

  if (env.AI_GATEWAY_CACHE_TTL) {
    const cacheTtl = Number(env.AI_GATEWAY_CACHE_TTL);
    if (Number.isFinite(cacheTtl) && cacheTtl > 0) {
      gateway.cacheTtl = cacheTtl;
    }
  }

  return options;
}

export function buildGatewayMeta(requestId: string, routing: RouterResponse) {
  return {
    requestId,
    model: routing.resolvedModel,
    policyVersion: routing.policyVersion,
    routeReason: routing.reason,
    via: routing.via
  };
}

export function buildProviderAllowlist(env: ProviderEnv): Array<"workers-ai" | "external"> {
  const allowlist: Array<"workers-ai" | "external"> = [];

  if (env.AI || env.AI_GATEWAY_ID) {
    allowlist.push("workers-ai");
  }

  if (env.EXTERNAL_PROVIDER_ENABLED === "true" && env.EXTERNAL_PROVIDER_BASE_URL) {
    allowlist.push("external");
  }

  if (allowlist.length === 0) {
    allowlist.push("workers-ai");
  }

  return allowlist;
}

export async function runInference(
  env: ProviderEnv,
  routing: RouterResponse,
  messages: ChatMessage[],
  stream: boolean,
  maxTokens: number,
  requestId: string
): Promise<unknown> {
  if (routing.via === "workers-ai") {
    if (!env.AI) {
      return createMockAiResponse(messages, stream, requestId, routing);
    }

    return env.AI.run(
      routing.cfModelId as keyof AiModels,
      {
        messages,
        stream,
        max_tokens: maxTokens
      },
      buildAiRunOptions(env)
    );
  }

  return runExternalInference(env, routing, messages, stream, maxTokens);
}

export function createMockAiResponse(
  messages: ChatMessage[],
  stream: boolean,
  _requestId: string,
  routing: RouterResponse
): AsyncIterable<ProviderStreamChunk> | { response: string } {
  const userPrompt = messages.at(-1)?.content ?? "Hello from the mock gateway";
  const output = `Mock response for "${userPrompt}" via ${routing.resolvedModel}.`;

  if (!stream) {
    return { response: output };
  }

  return {
    async *[Symbol.asyncIterator]() {
      for (const token of output.split(" ")) {
        yield {
          response: `${token} `
        };
      }
      yield {
        usage: {
          prompt_tokens: 0,
          completion_tokens: Math.max(Math.ceil(output.length / 4), 1),
          total_tokens: Math.max(Math.ceil(output.length / 4), 1)
        },
        done: true
      };
    }
  };
}

async function runExternalInference(
  env: ProviderEnv,
  routing: RouterResponse,
  messages: ChatMessage[],
  stream: boolean,
  maxTokens: number
): Promise<AsyncIterable<ProviderStreamChunk> | { response: string; usage?: Record<string, unknown> }> {
  const baseUrl = env.EXTERNAL_PROVIDER_BASE_URL;
  const apiKey = env.EXTERNAL_PROVIDER_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new Error("external provider is not configured");
  }

  enforceCircuitState(env, baseUrl);

  const response = await withRetry(env, baseUrl, async () => {
    const controller = new AbortController();
    const timeoutMs = parsePositiveInt(env.EXTERNAL_PROVIDER_TIMEOUT_MS, 20_000);
    const timeout = setTimeout(() => controller.abort("provider timeout"), timeoutMs);

    try {
      return await fetch(toProviderUrl(baseUrl, env.EXTERNAL_PROVIDER_PATH), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: withModelPrefix(routing.cfModelId, env.EXTERNAL_PROVIDER_MODEL_PREFIX),
          messages,
          stream,
          max_tokens: maxTokens
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  });

  if (!response.ok) {
    registerProviderFailure(env, baseUrl);
    throw new Error(`external provider failed with status ${response.status}`);
  }

  clearProviderFailures(baseUrl);

  if (stream) {
    return parseExternalSse(response);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
    usage?: Record<string, unknown>;
    output_text?: string;
  };

  return {
    response: readExternalContent(payload) ?? "",
    usage: payload.usage
  };
}

async function* parseExternalSse(
  response: Response
): AsyncIterable<ProviderStreamChunk> {
  if (!response.body) {
    throw new Error("external provider returned an empty stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    pending += decoder.decode(value, { stream: true });
    const events = pending.split("\n\n");
    pending = events.pop() ?? "";

    for (const event of events) {
      const parsed = parseExternalSseEvent(event);
      if (!parsed) {
        continue;
      }

      yield parsed;

      if (parsed.done || parsed.error) {
        return;
      }
    }
  }
}

function parseExternalSseEvent(event: string): ProviderStreamChunk | null {
  const lines = event
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());

  if (lines.length === 0) {
    return null;
  }

  const raw = lines.join("\n");
  if (raw === "[DONE]") {
    return { done: true };
  }

  try {
    const payload = JSON.parse(raw) as {
      choices?: Array<{
        delta?: { content?: string | Array<{ type?: string; text?: string }> };
        message?: { content?: string | Array<{ type?: string; text?: string }> };
        finish_reason?: string | null;
      }>;
      usage?: Record<string, unknown>;
      error?: { message?: string } | string;
    };
    const choice = payload.choices?.[0];
    const responseText = readExternalContent({
      choices: [
        {
          message: choice?.message,
          delta: choice?.delta
        } as unknown as { message?: { content?: string | Array<{ type?: string; text?: string }> } }
      ]
    });

    return {
      response: responseText || undefined,
      error:
        typeof payload.error === "string"
          ? payload.error
          : payload.error?.message,
      usage: payload.usage,
      done: choice?.finish_reason != null
    };
  } catch {
    return {
      response: raw
    };
  }
}

function readExternalContent(payload: {
  choices?: Array<{
    message?: { content?: string | Array<{ type?: string; text?: string }> };
    delta?: { content?: string | Array<{ type?: string; text?: string }> };
  }>;
  output_text?: string;
}): string | undefined {
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  const content = payload.choices?.[0]?.delta?.content ?? payload.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((entry) => (entry.type === "text" ? entry.text ?? "" : ""))
      .join("");
  }
  return undefined;
}

async function withRetry(
  env: ProviderEnv,
  circuitKey: string,
  operation: () => Promise<Response>
): Promise<Response> {
  const maxRetries = parsePositiveInt(env.EXTERNAL_PROVIDER_MAX_RETRIES, 2);
  const retryBaseMs = parsePositiveInt(env.EXTERNAL_PROVIDER_RETRY_BASE_MS, 150);

  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await operation();
      if (!isRetryableResponse(response.status) || attempt >= maxRetries) {
        return response;
      }
    } catch (error) {
      if (attempt >= maxRetries || !isRetryableError(error)) {
        registerProviderFailure(env, circuitKey);
        throw error;
      }
    }

    await sleep(retryBaseMs * Math.pow(2, attempt));
  }
}

function enforceCircuitState(env: ProviderEnv, circuitKey: string): void {
  const state = providerCircuitState.get(circuitKey);
  if (state?.openUntil && state.openUntil > Date.now()) {
    throw new Error("external provider circuit breaker is open");
  }
  if (state?.openUntil && state.openUntil <= Date.now()) {
    providerCircuitState.set(circuitKey, { failures: 0 });
  }
}

function registerProviderFailure(env: ProviderEnv, circuitKey: string): void {
  const threshold = parsePositiveInt(env.EXTERNAL_PROVIDER_CIRCUIT_FAILURE_THRESHOLD, 3);
  const cooldownSeconds = parsePositiveInt(env.EXTERNAL_PROVIDER_CIRCUIT_COOLDOWN_SECONDS, 60);
  const current = providerCircuitState.get(circuitKey) ?? { failures: 0 };
  const failures = current.failures + 1;

  providerCircuitState.set(circuitKey, {
    failures,
    openUntil: failures >= threshold ? Date.now() + cooldownSeconds * 1000 : undefined
  });
}

function clearProviderFailures(circuitKey: string): void {
  providerCircuitState.delete(circuitKey);
}

function isRetryableResponse(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isRetryableError(error: unknown): boolean {
  return error instanceof Error;
}

function toProviderUrl(baseUrl: string, path: string | undefined): string {
  return `${baseUrl.replace(/\/$/, "")}${path ?? "/v1/chat/completions"}`;
}

function withModelPrefix(model: string, prefix: string | undefined): string {
  if (!prefix) {
    return model;
  }
  return `${prefix}${model}`;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
