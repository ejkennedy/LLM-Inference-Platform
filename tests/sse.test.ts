import { describe, expect, it } from "vitest";

import { parseProviderSseEvent } from "../workers/gateway/src/sse";

describe("gateway SSE normalization helpers", () => {
  it("parses provider JSON SSE events", () => {
    const event = parseProviderSseEvent(
      'data: {"response":"hello","usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}\n\n'
    );

    expect(event).toEqual({
      type: "data",
      response: "hello",
      error: undefined,
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
});
