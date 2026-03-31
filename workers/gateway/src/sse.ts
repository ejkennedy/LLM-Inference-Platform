import type { RouterResponse } from "@llm-inference-platform/types";

type AiStreamChunk =
  | string
  | {
      response?: string | null;
      done?: boolean;
      error?: string;
      usage?: Record<string, unknown>;
    };

type StreamUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export async function normalizeReadableAiStream(
  stream: ReadableStream<Uint8Array>,
  requestId: string,
  routing: RouterResponse
): Promise<Response> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let completionText = "";
  let pending = "";
  let usage: StreamUsage | undefined;

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        encoder.encode(
          toSseFrame("meta", {
            requestId,
            model: routing.resolvedModel
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

          if (parsed.type === "done") {
            controller.enqueue(encoder.encode(toSummaryFrame(completionText, usage)));
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
            controller.enqueue(encoder.encode(toSummaryFrame(completionText, usage)));
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
            usage = normalizeUsage(parsed.usage);
            controller.enqueue(
              encoder.encode(
                toSseFrame("usage", usage)
              )
            );
          }
        }
      }

      controller.enqueue(encoder.encode(toSummaryFrame(completionText, usage)));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    }
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Request-Id": requestId,
      "X-Resolved-Model": routing.resolvedModel
    }
  });
}

export async function normalizeIterableAiStream(
  stream: AsyncIterable<AiStreamChunk>,
  requestId: string,
  routing: RouterResponse
): Promise<Response> {
  const encoder = new TextEncoder();
  let completionText = "";
  let usage: StreamUsage | undefined;

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        encoder.encode(
          toSseFrame("meta", {
            requestId,
            model: routing.resolvedModel
          })
        )
      );

      for await (const chunk of stream) {
        if (typeof chunk === "string") {
          completionText += chunk;
          controller.enqueue(encoder.encode(toSseFrame("token", { delta: chunk })));
          continue;
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
          usage = normalizeUsage(chunk.usage);
          controller.enqueue(encoder.encode(toSseFrame("usage", usage)));
        }

        if (chunk.done) {
          break;
        }
      }

      controller.enqueue(encoder.encode(toSummaryFrame(completionText, usage)));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    }
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Request-Id": requestId,
      "X-Resolved-Model": routing.resolvedModel
    }
  });
}

export function parseProviderSseEvent(event: string): {
  type: "data" | "done";
  response?: string;
  error?: string;
  usage?: Record<string, unknown>;
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
    };
    return {
      type: "data",
      response: parsed.response ?? undefined,
      error: parsed.error,
      usage: parsed.usage
    };
  } catch {
    return {
      type: "data",
      response: raw
    };
  }
}

function toSseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function toSummaryFrame(completionText: string, usage?: StreamUsage): string {
  return toSseFrame("summary", {
    completionChars: completionText.length,
    estimatedCompletionTokens: Math.max(Math.ceil(completionText.length / 4), 1),
    usage
  });
}

function normalizeUsage(usage: Record<string, unknown>): StreamUsage {
  return {
    promptTokens: toNumber(usage.prompt_tokens),
    completionTokens: toNumber(usage.completion_tokens),
    totalTokens: toNumber(usage.total_tokens)
  };
}

function toNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
