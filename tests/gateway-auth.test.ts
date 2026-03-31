import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  authenticateRequest,
  estimatePromptTokens,
  estimateTextTokens
} from "../workers/gateway/src/auth";

function createJwt(
  secret: string,
  payload: Record<string, unknown>
): string {
  const encodedHeader = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
    "utf8"
  ).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");

  return `${signingInput}.${signature}`;
}

describe("gateway auth helpers", () => {
  const now = Math.floor(Date.now() / 1000);
  const secret = "test-secret";

  it("authenticates a valid HS256 bearer token", async () => {
    const token = createJwt(secret, {
      sub: "demo-user",
      tier: "standard",
      budgetLimitCents: 500,
      exp: now + 3600
    });
    const request = new Request("https://example.com/v1/chat", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const claims = await authenticateRequest(request, secret);

    expect(claims.sub).toBe("demo-user");
    expect(claims.tier).toBe("standard");
    expect(claims.budgetLimitCents).toBe(500);
  });

  it("rejects requests without a bearer token", async () => {
    const request = new Request("https://example.com/v1/chat");

    await expect(authenticateRequest(request, secret)).rejects.toBeInstanceOf(Response);
    await expect(authenticateRequest(request, secret)).rejects.toMatchObject({ status: 401 });
  });

  it("rejects expired tokens", async () => {
    const token = createJwt(secret, {
      sub: "demo-user",
      tier: "standard",
      budgetLimitCents: 500,
      exp: now - 10
    });
    const request = new Request("https://example.com/v1/chat", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    await expect(authenticateRequest(request, secret)).rejects.toMatchObject({ status: 401 });
  });

  it("estimates prompt and completion tokens with a simple char heuristic", () => {
    const promptTokens = estimatePromptTokens([
      { content: "12345678" },
      { content: "1234" }
    ]);
    const completionTokens = estimateTextTokens("abcdefgh");

    expect(promptTokens).toBe(3);
    expect(completionTokens).toBe(2);
  });
});
