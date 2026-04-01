import {
  createHmac,
  createSign,
  generateKeyPairSync
} from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  authenticateRequest,
  estimatePromptTokens,
  estimateTextTokens,
  requireAdminClaims
} from "../workers/gateway/src/auth";

function createHsJwt(
  secret: string,
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "HS256", typ: "JWT" }
): string {
  const encodedHeader = Buffer.from(JSON.stringify(header), "utf8").toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");

  return `${signingInput}.${signature}`;
}

function createRsJwt(
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "RS256", typ: "JWT", kid: "test-key" }
): string {
  const encodedHeader = Buffer.from(JSON.stringify(header), "utf8").toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey).toString("base64url");

  return `${signingInput}.${signature}`;
}

describe("gateway auth helpers", () => {
  const now = Math.floor(Date.now() / 1000);
  const sharedSecret = "test-secret";
  const basePayload = {
    sub: "demo-user",
    tier: "standard",
    budgetLimitCents: 500,
    tenantId: "tenant-1",
    exp: now + 3600
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("authenticates a valid HS256 bearer token", async () => {
    const token = createHsJwt(sharedSecret, basePayload);
    const request = new Request("https://example.com/v1/chat", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const claims = await authenticateRequest(request, { jwtSecret: sharedSecret });

    expect(claims.sub).toBe("demo-user");
    expect(claims.tier).toBe("standard");
    expect(claims.budgetLimitCents).toBe(500);
  });

  it("accepts a previous shared secret during rotation", async () => {
    const token = createHsJwt("old-secret", basePayload);
    const request = new Request("https://example.com/v1/chat", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const claims = await authenticateRequest(request, {
      jwtSecret: "new-secret",
      jwtSecretPrevious: "old-secret"
    });

    expect(claims.sub).toBe("demo-user");
  });

  it("authenticates a valid RS256 token via JWKS", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048
    });
    const publicJwk = publicKey.export({ format: "jwk" });
    const token = createRsJwt(privateKey, {
      ...basePayload,
      iss: "https://issuer.example",
      aud: "llm-gateway"
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            keys: [{ ...publicJwk, kid: "test-key", use: "sig", alg: "RS256" }]
          })
        )
      )
    );

    const claims = await authenticateRequest(
      new Request("https://example.com/v1/chat", {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }),
      {
        jwtJwksUrl: "https://issuer.example/.well-known/jwks.json",
        jwtIssuer: "https://issuer.example",
        jwtAudience: "llm-gateway"
      }
    );

    expect(claims.iss).toBe("https://issuer.example");
    expect(claims.aud).toBe("llm-gateway");
  });

  it("rejects requests without a bearer token", async () => {
    const request = new Request("https://example.com/v1/chat");

    await expect(authenticateRequest(request, { jwtSecret: sharedSecret })).rejects.toBeInstanceOf(Response);
  });

  it("rejects expired tokens", async () => {
    const token = createHsJwt(sharedSecret, {
      ...basePayload,
      exp: now - 120
    });
    const request = new Request("https://example.com/v1/chat", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    await expect(authenticateRequest(request, { jwtSecret: sharedSecret })).rejects.toMatchObject({ status: 401 });
  });

  it("rejects mismatched audience claims", async () => {
    const token = createHsJwt(sharedSecret, {
      ...basePayload,
      aud: "different-audience"
    });

    await expect(
      authenticateRequest(
        new Request("https://example.com/v1/chat", {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }),
        {
          jwtSecret: sharedSecret,
          jwtAudience: "llm-gateway"
        }
      )
    ).rejects.toMatchObject({ status: 401 });
  });

  it("requires admin claims for billing endpoints", () => {
    expect(() =>
      requireAdminClaims({
        ...basePayload,
        sub: "admin-user",
        role: "admin",
        scopes: []
      })
    ).not.toThrow();

    expect(() =>
      requireAdminClaims({
        ...basePayload,
        sub: "normal-user",
        scopes: ["chat:write"]
      })
    ).toThrow();
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
