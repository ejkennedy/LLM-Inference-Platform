import { describe, expect, it } from "vitest";

import type { RouterResponse } from "@llm-inference-platform/types";

import {
  buildAiRunOptions,
  createMockAiResponse
} from "../workers/gateway/src/provider";

describe("gateway provider helpers", () => {
  const routing: RouterResponse = {
    resolvedModel: "llama-3.1-8b",
    cfModelId: "@cf/meta/llama-3.1-8b-instruct",
    expectedCostCents: 0.1,
    via: "workers-ai",
    reason: "requested-model",
    policyVersion: "test"
  };

  it("returns no AI Gateway options when the gateway is not configured", () => {
    expect(buildAiRunOptions({})).toBeUndefined();
  });

  it("builds AI Gateway options with cache controls", () => {
    expect(
      buildAiRunOptions({
        AI_GATEWAY_ID: "gateway-1",
        AI_GATEWAY_SKIP_CACHE: "true",
        AI_GATEWAY_CACHE_TTL: "120"
      })
    ).toEqual({
      gateway: {
        id: "gateway-1",
        skipCache: true,
        cacheTtl: 120
      }
    });
  });

  it("creates a gateway-shaped mock SSE stream", async () => {
    const stream = createMockAiResponse(
      [{ role: "user", content: "hello" }],
      true,
      "req-1",
      routing
    );

    expect(stream).toBeInstanceOf(ReadableStream);
    const response = new Response(stream as ReadableStream);
    const body = await response.text();

    expect(body).toContain("event: meta");
    expect(body).toContain("event: token");
    expect(body).toContain("event: summary");
    expect(body).toContain("data: [DONE]");
  });
});
