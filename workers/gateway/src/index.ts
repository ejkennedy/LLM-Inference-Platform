import type {
  GatewayRequest,
  HealthResponse,
  RouterRequest,
  RouterResponse
} from "@llm-inference-platform/types";

export interface Env {
  AI: Ai;
  MODEL_CATALOGUE: KVNamespace;
  ROUTER: Fetcher;
  RATE_LIMITER: DurableObjectNamespace;
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
  async fetch(request: Request, env: Env): Promise<Response> {
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

    if (request.method !== "POST" || url.pathname !== "/v1/chat") {
      return withCors(new Response("Not Found", { status: 404 }));
    }

    const payload = (await request.json()) as GatewayRequest;
    const requestId = payload.requestId ?? request.headers.get("X-Request-Id") ?? crypto.randomUUID();
    const messages = payload.messages ?? [];

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
      userTier: payload.userTier ?? "free",
      budgetRemainingCents: payload.budgetRemainingCents ?? 100,
      requestedModel: payload.model,
      promptTokensEstimate: estimatePromptTokens(messages),
      maxOutputTokens: payload.maxTokens ?? 512,
      providerAllowlist: ["workers-ai"]
    });

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

    const streamResponse = await env.AI.run(routing.cfModelId as keyof AiModels, {
      messages,
      stream: payload.stream ?? true,
      max_tokens: payload.maxTokens ?? 512
    });

    if (streamResponse instanceof ReadableStream) {
      return withCors(
        new Response(streamResponse, {
          headers: sseHeaders(requestId, routing)
        }),
        requestId
      );
    }

    return withCors(await normalizeAiStream(streamResponse, requestId, routing), requestId);
  }
};

export class RateLimiter {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/check") {
      return new Response("Not Found", { status: 404 });
    }

    const now = Date.now();
    const minuteBucket = Math.floor(now / 60_000);
    const key = `rpm:${minuteBucket}`;
    const count = ((await this.state.storage.get<number>(key)) ?? 0) + 1;
    await this.state.storage.put(key, count);

    return json({
      allow: count <= 60,
      remaining: Math.max(60 - count, 0),
      window: {
        type: "minute",
        bucket: minuteBucket
      }
    });
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

async function normalizeAiStream(
  stream: AsyncIterable<AiStreamChunk> | unknown,
  requestId: string,
  routing: RouterResponse
): Promise<Response> {
  if (!isAsyncIterable(stream)) {
    return json(
      {
        requestId,
        status: "error",
        message: "Workers AI returned an unsupported response shape"
      },
      { status: 502 }
    );
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(toSseFrame("meta", { requestId, model: routing.resolvedModel })));

      for await (const chunk of stream) {
        if (typeof chunk === "string") {
          controller.enqueue(encoder.encode(toSseFrame("token", { delta: chunk })));
          continue;
        }

        if (chunk.error) {
          controller.enqueue(encoder.encode(toSseFrame("error", { message: chunk.error })));
          break;
        }

        if (chunk.response) {
          controller.enqueue(encoder.encode(toSseFrame("token", { delta: chunk.response })));
        }

        if (chunk.done) {
          break;
        }
      }

      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    }
  });

  return new Response(readable, {
    headers: sseHeaders(requestId, routing)
  });
}

function estimatePromptTokens(messages: Array<{ content: string }>): number {
  const totalChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  return Math.max(Math.ceil(totalChars / 4), 1);
}

function isAsyncIterable(value: unknown): value is AsyncIterable<AiStreamChunk> {
  return Boolean(value) && typeof (value as AsyncIterable<AiStreamChunk>)[Symbol.asyncIterator] === "function";
}

function toSseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
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
