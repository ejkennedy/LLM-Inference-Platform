import { afterEach, describe, expect, it, vi } from "vitest";

import type { RouterResponse } from "@llm-inference-platform/types";

import {
  buildAiRunOptions,
  buildProviderAllowlist,
  createMockAiResponse,
  runInference
} from "../workers/gateway/src/provider";

describe("gateway provider helpers", () => {
  const workersRouting: RouterResponse = {
    resolvedModel: "llama-3.1-8b",
    cfModelId: "@cf/meta/llama-3.1-8b-instruct",
    expectedCostCents: 0.1,
    via: "workers-ai",
    reason: "requested-model",
    policyVersion: "test"
  };

  const externalRouting: RouterResponse = {
    resolvedModel: "gpt-4.1-mini",
    cfModelId: "gpt-4.1-mini",
    expectedCostCents: 0.2,
    via: "external",
    reason: "budget-fallback",
    policyVersion: "test"
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
        skipCache: true
      }
    });
  });

  it("applies prompt cache policy to AI Gateway options", () => {
    expect(
      buildAiRunOptions(
        {
          AI_GATEWAY_ID: "gateway-1",
          AI_GATEWAY_CACHE_TTL: "120"
        },
        {
          messages: [],
          cacheControl: {
            ttlSeconds: 45
          }
        }
      )
    ).toEqual({
      gateway: {
        id: "gateway-1",
        cacheTtl: 45
      }
    });
  });

  it("builds a provider allowlist from available provider config", () => {
    expect(buildProviderAllowlist({ AI: {} as Ai })).toEqual(["workers-ai"]);
    expect(
      buildProviderAllowlist({
        EXTERNAL_PROVIDER_ENABLED: "true",
        EXTERNAL_PROVIDER_BASE_URL: "https://provider.example"
      })
    ).toEqual(["external"]);
  });

  it("creates provider-style mock stream chunks for normalization", async () => {
    const stream = createMockAiResponse(
      [{ role: "user", content: "hello" }],
      true,
      "req-1",
      workersRouting
    );

    const chunks = [];
    for await (const chunk of stream as AsyncIterable<Record<string, unknown>>) {
      chunks.push(chunk);
    }

    expect(chunks.some((chunk) => typeof chunk.response === "string")).toBe(true);
    expect(chunks.at(-1)).toMatchObject({
      done: true
    });
  });

  it("normalizes an external JSON completion response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "hello from external" } }],
            usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }
          })
        )
      )
    );

    const response = await runInference(
      {
        EXTERNAL_PROVIDER_ENABLED: "true",
        EXTERNAL_PROVIDER_BASE_URL: "https://provider.example",
        EXTERNAL_PROVIDER_API_KEY: "secret"
      },
      externalRouting,
      [{ role: "user", content: "hello" }],
      false,
      128,
      "req-1"
    );

    expect(response.upstream).toMatchObject({
      response: "hello from external"
    });
  });

  it("retries a transient external failure before succeeding", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("retry", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          "data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\ndata: [DONE]\n\n",
          {
            status: 200,
            headers: {
              "Content-Type": "text/event-stream"
            }
          }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const stream = await runInference(
      {
        EXTERNAL_PROVIDER_ENABLED: "true",
        EXTERNAL_PROVIDER_BASE_URL: "https://provider.example",
        EXTERNAL_PROVIDER_API_KEY: "secret",
        EXTERNAL_PROVIDER_RETRY_BASE_MS: "1"
      },
      externalRouting,
      [{ role: "user", content: "hello" }],
      true,
      128,
      "req-1"
    );

    const chunks = [];
    for await (const chunk of stream.upstream as AsyncIterable<Record<string, unknown>>) {
      chunks.push(chunk);
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(chunks[0]).toMatchObject({
      response: "hello"
    });
  });

  it("routes Workers AI calls through binding-based AI Gateway options when configured", async () => {
    const runMock = vi.fn(async () => ({ response: "hello from gateway" }));

    const response = await runInference(
      {
        AI: {
          run: runMock
        } as unknown as Ai,
        AI_GATEWAY_ID: "gateway-1",
        AI_GATEWAY_ACCOUNT_ID: "acct",
        AI_GATEWAY_TOKEN: "token"
      },
      workersRouting,
      [{ role: "user", content: "hello" }],
      false,
      128,
      "req-1",
      {
        messages: [],
        cacheControl: {
          ttlSeconds: 30
        }
      },
      {
        promptId: "concise-assistant",
        version: "v1",
        promptText: "Be concise.",
        checksum: "checksum",
        lastUpdatedBy: "tester"
      }
    );

    expect(runMock).toHaveBeenCalledWith(
      "@cf/meta/llama-3.1-8b-instruct",
      expect.objectContaining({
        messages: [{ role: "user", content: "hello" }],
        stream: false,
        max_tokens: 128
      }),
      {
        gateway: {
          id: "gateway-1",
          cacheTtl: 30
        }
      }
    );
    expect(response.meta).toMatchObject({
      promptId: "concise-assistant",
      promptVersion: "v1"
    });
  });

  it("opens the circuit breaker after repeated external failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 503 }))
    );

    const env = {
      EXTERNAL_PROVIDER_ENABLED: "true",
      EXTERNAL_PROVIDER_BASE_URL: "https://provider.example",
      EXTERNAL_PROVIDER_API_KEY: "secret",
      EXTERNAL_PROVIDER_MAX_RETRIES: "0",
      EXTERNAL_PROVIDER_CIRCUIT_FAILURE_THRESHOLD: "1",
      EXTERNAL_PROVIDER_CIRCUIT_COOLDOWN_SECONDS: "60"
    };

    await expect(
      runInference(env, externalRouting, [{ role: "user", content: "hello" }], false, 128, "req-1")
    ).rejects.toThrow(/external provider failed/);

    await expect(
      runInference(env, externalRouting, [{ role: "user", content: "hello" }], false, 128, "req-2")
    ).rejects.toThrow(/circuit breaker is open/);
  });
});
