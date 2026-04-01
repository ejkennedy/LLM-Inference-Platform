import { describe, expect, it } from "vitest";

import {
  normalizeReadableAiStream,
  normalizeIterableAiStream,
  parseProviderSseEvent
} from "../workers/gateway/src/sse";

describe("gateway SSE normalization helpers", () => {
  it("parses provider JSON SSE events", () => {
    const event = parseProviderSseEvent(
      'data: {"response":"hello","usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3},"finish_reason":"stop"}\n\n'
    );

    expect(event).toEqual({
      type: "data",
      response: "hello",
      error: undefined,
      finishReason: "stop",
      usage: {
        prompt_tokens: 1,
        completion_tokens: 2,
        total_tokens: 3
      }
    });
  });

  it("parses provider done frames", () => {
    const event = parseProviderSseEvent("data: [DONE]\n\n");

    expect(event).toEqual({ type: "done" });
  });

  it("falls back to raw text when the payload is not JSON", () => {
    const event = parseProviderSseEvent("data: plain-text-token\n\n");

    expect(event).toEqual({
      type: "data",
      response: "plain-text-token"
    });
  });

  it("skips empty terminal usage frames during normalization", async () => {
    const response = await normalizeIterableAiStream(
      {
        async *[Symbol.asyncIterator]() {
          yield { response: "hello" };
          yield {
            usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
          };
          yield {
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            done: true
          };
        }
      },
      "req-1",
      {
        resolvedModel: "llama-3.1-8b",
        cfModelId: "@cf/meta/llama-3.1-8b-instruct",
        expectedCostCents: 0.1,
        via: "workers-ai",
        reason: "requested-model",
        policyVersion: "test"
      }
    );

    const text = await response.text();

    expect(text.match(/event: usage/g)).toHaveLength(1);
    expect(text).toContain('"promptTokens":3');
    expect(text).not.toContain('"promptTokens":0');
  });

  it("fires completion callbacks for readable provider streams on done frames", async () => {
    let summary:
      | {
          completionText: string;
          totalMs: number;
        }
      | undefined;

    const encoder = new TextEncoder();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"response":"hello"}\n\ndata: [DONE]\n\n')
        );
        controller.close();
      }
    });

    const response = await normalizeReadableAiStream(
      upstream,
      "req-1",
      {
        resolvedModel: "llama-3.1-8b",
        cfModelId: "@cf/meta/llama-3.1-8b-instruct",
        expectedCostCents: 0.1,
        via: "workers-ai",
        reason: "requested-model",
        policyVersion: "test"
      },
      {
        onComplete(result) {
          summary = {
            completionText: result.completionText,
            totalMs: result.totalMs
          };
        }
      }
    );

    await response.text();

    expect(summary).toMatchObject({
      completionText: "hello"
    });
    expect(summary?.totalMs).toBeGreaterThanOrEqual(0);
  });
});
