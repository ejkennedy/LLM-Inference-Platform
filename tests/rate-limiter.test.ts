import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RateLimiter } from "../workers/gateway/src/index";

class MemoryStorage {
  private readonly data = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }
}

function createRateLimiter() {
  const storage = new MemoryStorage();
  const state = {
    storage
  } as unknown as DurableObjectState;

  return {
    limiter: new RateLimiter(state),
    storage
  };
}

describe("gateway rate limiter durable object", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-31T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows a request and reserves budget", async () => {
    const { limiter } = createRateLimiter();

    const response = await limiter.fetch(
      new Request("https://rate-limiter.internal/check", {
        method: "POST",
        body: JSON.stringify({
          requestId: "req-1",
          userId: "demo-user",
          budgetLimitCents: 500,
          estimatedCostCents: 12.5
        })
      })
    );
    const body = await response.json();

    expect(body).toMatchObject({
      allow: true,
      reason: "allowed",
      remaining: 59
    });
  });

  it("returns a budget denial when the reserved spend would exceed the limit", async () => {
    const { limiter } = createRateLimiter();

    const response = await limiter.fetch(
      new Request("https://rate-limiter.internal/check", {
        method: "POST",
        body: JSON.stringify({
          requestId: "req-1",
          userId: "demo-user",
          budgetLimitCents: 5,
          estimatedCostCents: 12.5
        })
      })
    );
    const body = await response.json();

    expect(body).toMatchObject({
      allow: false,
      reason: "budget"
    });
  });

  it("tracks spend reconciliation and exposes usage summary", async () => {
    const { limiter } = createRateLimiter();

    await limiter.fetch(
      new Request("https://rate-limiter.internal/check", {
        method: "POST",
        body: JSON.stringify({
          requestId: "req-1",
          userId: "demo-user",
          budgetLimitCents: 500,
          estimatedCostCents: 10
        })
      })
    );

    await limiter.fetch(
      new Request("https://rate-limiter.internal/spend", {
        method: "POST",
        body: JSON.stringify({
          requestId: "req-1",
          estimatedCostCents: 10,
          actualCostCents: 7.5
        })
      })
    );

    const response = await limiter.fetch(
      new Request("https://rate-limiter.internal/balance")
    );
    const body = await response.json();

    expect(body).toMatchObject({
      budgetLimitCents: 500,
      estimatedSpendCents: 7.5,
      remainingBudgetCents: 492.5,
      requestCountCurrentMinute: 1
    });
  });

  it("returns a rate-limit denial after 60 requests in the same minute", async () => {
    const { limiter } = createRateLimiter();

    for (let index = 0; index < 60; index += 1) {
      await limiter.fetch(
        new Request("https://rate-limiter.internal/check", {
          method: "POST",
          body: JSON.stringify({
            requestId: `req-${index}`,
            userId: "demo-user",
            budgetLimitCents: 5_000,
            estimatedCostCents: 1
          })
        })
      );
    }

    const response = await limiter.fetch(
      new Request("https://rate-limiter.internal/check", {
        method: "POST",
        body: JSON.stringify({
          requestId: "req-overflow",
          userId: "demo-user",
          budgetLimitCents: 5_000,
          estimatedCostCents: 1
        })
      })
    );
    const body = await response.json();

    expect(body).toMatchObject({
      allow: false,
      reason: "rate_limit"
    });
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
  });
});
