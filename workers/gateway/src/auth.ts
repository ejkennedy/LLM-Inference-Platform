import type { AuthClaims } from "@llm-inference-platform/types";

export async function authenticateRequest(
  request: Request,
  jwtSecret?: string
): Promise<AuthClaims> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw errorResponse("missing bearer token", 401);
  }

  if (!jwtSecret) {
    throw errorResponse("JWT_SECRET is not configured", 500);
  }

  const token = authHeader.slice("Bearer ".length);
  const [header64, payload64, signature64] = token.split(".");
  if (!header64 || !payload64 || !signature64) {
    throw errorResponse("invalid JWT format", 401);
  }

  const header = JSON.parse(decodeBase64Url(header64)) as { alg?: string };
  if (header.alg !== "HS256") {
    throw errorResponse("unsupported JWT algorithm", 401);
  }

  const signingInput = `${header64}.${payload64}`;
  const signatureBytes = base64UrlToBytes(signature64);
  const signatureBuffer = new Uint8Array(signatureBytes.byteLength);
  signatureBuffer.set(signatureBytes);
  const secret = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(jwtSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    secret,
    signatureBuffer,
    new TextEncoder().encode(signingInput)
  );

  if (!valid) {
    throw errorResponse("invalid JWT signature", 401);
  }

  const payload = JSON.parse(decodeBase64Url(payload64)) as Partial<AuthClaims>;
  const now = Math.floor(Date.now() / 1000);
  if (payload.nbf && payload.nbf > now) {
    throw errorResponse("token not yet valid", 401);
  }
  if (payload.exp && payload.exp <= now) {
    throw errorResponse("token expired", 401);
  }
  if (!payload.sub || !payload.tier || typeof payload.budgetLimitCents !== "number") {
    throw errorResponse("token missing required claims", 401);
  }

  return {
    sub: payload.sub,
    tier: payload.tier,
    budgetLimitCents: payload.budgetLimitCents,
    tenantId: payload.tenantId,
    iat: payload.iat,
    exp: payload.exp,
    nbf: payload.nbf
  };
}

export function estimatePromptTokens(messages: Array<{ content: string }>): number {
  const totalChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  return Math.max(Math.ceil(totalChars / 4), 1);
}

export function estimateTextTokens(text: string): number {
  return Math.max(Math.ceil(text.length / 4), 1);
}

function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ status: "error", message }, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return atob(padded);
}

function base64UrlToBytes(input: string): Uint8Array {
  const binary = decodeBase64Url(input);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
