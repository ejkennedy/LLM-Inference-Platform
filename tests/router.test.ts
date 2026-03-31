import { describe, expect, it } from "vitest";

import type { RouterRequest } from "@llm-inference-platform/types";

import {
  defaultCatalogue,
  estimateCost,
  resolveRoute
} from "../workers/router/src/policy";

describe("router policy", () => {
  const baseRequest: RouterRequest = {
    requestId: "req-1",
    userTier: "standard",
    budgetRemainingCents: 100,
    requestedModel: "llama-3.1-8b",
    promptTokensEstimate: 800,
    maxOutputTokens: 200
  };

  it("uses the requested model when it fits policy", () => {
    const result = resolveRoute(baseRequest, structuredClone(defaultCatalogue));

    expect(result.resolvedModel).toBe("llama-3.1-8b");
    expect(result.reason).toBe("requested-model");
    expect(result.via).toBe("workers-ai");
  });

  it("caps free-tier users to the fast model", () => {
    const result = resolveRoute(
      {
        ...baseRequest,
        userTier: "free",
        requestedModel: "llama-3.1-70b"
      },
      structuredClone(defaultCatalogue)
    );

    expect(result.resolvedModel).toBe("llama-3.1-8b");
    expect(result.reason).toBe("free-tier-cap");
  });

  it("falls back when the estimated cost exceeds remaining budget", () => {
    const expensiveRequest: RouterRequest = {
      ...baseRequest,
      requestedModel: "llama-3.1-8b",
      budgetRemainingCents: 0.0001,
      promptTokensEstimate: 10_000,
      maxOutputTokens: 4_000
    };

    const result = resolveRoute(expensiveRequest, structuredClone(defaultCatalogue));

    expect(result.resolvedModel).toBe("llama-3.1-70b");
    expect(result.reason).toBe("budget-fallback");
  });

  it("estimates model cost from prompt and completion tokens", () => {
    const estimate = estimateCost(baseRequest, defaultCatalogue["llama-3.1-8b"]);

    expect(estimate).toBeCloseTo(0.032, 3);
  });
});
