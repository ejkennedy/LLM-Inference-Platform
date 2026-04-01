import type { RouterResponse } from "@llm-inference-platform/types";

type AiStreamChunk =
  | string
  | {
      response?: string | null;
      done?: boolean;
      error?: string;
      usage?: Record<string, unknown>;
      finishReason?: string | null;
    };

type StreamUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

type StreamMeta = {
  requestId: string;
  model: string;
  promptId?: string;
  promptVersion?: string;
  cacheStatus?: string;
};

export async function normalizeReadableAiStream(
  stream: ReadableStream<Uint8Array>,
  requestId: string,
  routing: RouterResponse,
  options?: {
    extraHeaders?: HeadersInit;
    meta?: Partial<StreamMeta>;
  }
): Promise<Response> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let completionText = "";
  let pending = "";
  let usage: StreamUsage | undefined;
  let finishReason: string | undefined;

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        encoder.encode(
          toSseFrame("meta", {
            requestId,
            model: routing.resolvedModel,
            ...options?.meta
          })
        )
      );

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        pending += decoder.decode(value, { stream: true });
        const events = pending.split("\n\n");
        pending = events.pop() ?? "";

        for (const event of events) {
          const parsed = parseProviderSseEvent(event);
          if (!parsed) {
            continue;
          }

          if (parsed.finishReason) {
            finishReason = parsed.finishReason;
          }

          if (parsed.type === "done") {
            controller.enqueue(encoder.encode(toSummaryFrame(completionText, usage, finishReason)));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            return;
          }

          if (parsed.error) {
            controller.enqueue(
              encoder.encode(
                toSseFrame("error", {
                  message: parsed.error
                })
              )
            );
            controller.enqueue(encoder.encode(toSummaryFrame(completionText, usage, finishReason)));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            return;
          }

          if (parsed.response) {
            completionText += parsed.response;
            controller.enqueue(
              encoder.encode(
                toSseFrame("token", {
                  delta: parsed.response
                })
              )
            );
          }

          if (parsed.usage) {
            const normalizedUsage = normalizeUsage(parsed.usage);
            if (hasMeaningfulUsage(normalizedUsage)) {
              usage = normalizedUsage;
              controller.enqueue(encoder.encode(toSseFrame("usage", normalizedUsage)));
            }
          }
        }
      }

      controller.enqueue(encoder.encode(toSummaryFrame(completionText, usage, finishReason)));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
    async cancel() {
      await reader.cancel();
    }
  });

  return new Response(readable, {
    headers: buildSseHeaders(requestId, routing, options?.extraHeaders)
  });
}

export async function normalizeIterableAiStream(
  stream: AsyncIterable<AiStreamChunk>,
  requestId: string,
  routing: RouterResponse,
  options?: {
    extraHeaders?: HeadersInit;
    meta?: Partial<StreamMeta>;
  }
): Promise<Response> {
  const encoder = new TextEncoder();
  let completionText = "";
  let usage: StreamUsage | undefined;
  let finishReason: string | undefined;

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        encoder.encode(
          toSseFrame("meta", {
            requestId,
            model: routing.resolvedModel,
            ...options?.meta
          })
        )
      );

      for await (const chunk of stream) {
        if (typeof chunk === "string") {
          completionText += chunk;
          controller.enqueue(encoder.encode(toSseFrame("token", { delta: chunk })));
          continue;
        }

        if (chunk.finishReason) {
          finishReason = chunk.finishReason ?? undefined;
        }

        if (chunk.error) {
          controller.enqueue(
            encoder.encode(toSseFrame("error", { message: chunk.error }))
          );
          break;
        }

        if (chunk.response) {
          completionText += chunk.response;
          controller.enqueue(
            encoder.encode(toSseFrame("token", { delta: chunk.response }))
          );
        }

        if (chunk.usage) {
          const normalizedUsage = normalizeUsage(chunk.usage);
          if (hasMeaningfulUsage(normalizedUsage)) {
            usage = normalizedUsage;
            controller.enqueue(encoder.encode(toSseFrame("usage", normalizedUsage)));
          }
        }

        if (chunk.done) {
          break;
        }
      }

      controller.enqueue(encoder.encode(toSummaryFrame(completionText, usage, finishReason)));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    }
  });

  return new Response(readable, {
    headers: buildSseHeaders(requestId, routing, options?.extraHeaders)
  });
}

export function parseProviderSseEvent(event: string): {
  type: "data" | "done";
  response?: string;
  error?: string;
  usage?: Record<string, unknown>;
  finishReason?: string;
} | null {
  const dataLines = event
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());

  if (dataLines.length === 0) {
    return null;
  }

  const raw = dataLines.join("\n");
  if (raw === "[DONE]") {
    return { type: "done" };
  }

  try {
    const parsed = JSON.parse(raw) as {
      response?: string | null;
      error?: string;
      usage?: Record<string, unknown>;
      finish_reason?: string | null;
      choices?: Array<{
        finish_reason?: string | null;
        delta?: { content?: string };
      }>;
    };
    return {
      type: "data",
      response:
        parsed.response
        ?? parsed.choices?.[0]?.delta?.content
        ?? undefined,
      error: parsed.error,
      usage: parsed.usage,
      finishReason:
        parsed.finish_reason
        ?? parsed.choices?.[0]?.finish_reason
        ?? undefined
    };
  } catch {
    return {
      type: "data",
      response: raw
    };
  }
}

function buildSseHeaders(
  requestId: string,
  routing: RouterResponse,
  extraHeaders?: HeadersInit
): Headers {
  const headers = new Headers({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Request-Id": requestId,
    "X-Resolved-Model": routing.resolvedModel
  });

  if (extraHeaders) {
    const extras = new Headers(extraHeaders);
    extras.forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

function toSseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function toSummaryFrame(
  completionText: string,
  usage?: StreamUsage,
  finishReason?: string
): string {
  return toSseFrame("summary", {
    completionChars: completionText.length,
    estimatedCompletionTokens: Math.max(Math.ceil(completionText.length / 4), 1),
    usage,
    finishReason
  });
}

function normalizeUsage(usage: Record<string, unknown>): StreamUsage {
  return {
    promptTokens: toNumber(usage.prompt_tokens),
    completionTokens: toNumber(usage.completion_tokens),
    totalTokens: toNumber(usage.total_tokens)
  };
}

function hasMeaningfulUsage(usage: StreamUsage): boolean {
  return (usage.promptTokens ?? 0) > 0
    || (usage.completionTokens ?? 0) > 0
    || (usage.totalTokens ?? 0) > 0;
}

function toNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
