import type { AuthClaims, UserTier } from "@llm-inference-platform/types";

export type AuthConfig = {
  jwtSecret?: string;
  jwtSecretPrevious?: string;
  jwtSecretNext?: string;
  jwtJwksUrl?: string;
  jwtIssuer?: string;
  jwtAudience?: string;
  jwtClockSkewSeconds?: string;
  jwtJwksCacheTtlSeconds?: string;
};

type JwtHeader = {
  alg?: string;
  typ?: string;
  kid?: string;
};

type JwksDocument = {
  keys?: JwkWithKid[];
};

type JwkWithKid = JsonWebKey & {
  kid: string;
};

const SUPPORTED_SHARED_SECRET_ALGS = new Set(["HS256"]);
const SUPPORTED_JWKS_ALGS = new Set(["RS256"]);
const VALID_TIERS = new Set<UserTier>(["free", "standard", "pro"]);
const VALID_ROLES = new Set(["user", "admin"]);
const DEFAULT_CLOCK_SKEW_SECONDS = 60;
const DEFAULT_JWKS_CACHE_TTL_SECONDS = 300;

let jwksCache:
  | {
      url: string;
      expiresAt: number;
      keys: JwkWithKid[];
    }
  | undefined;

export async function authenticateRequest(
  request: Request,
  config: AuthConfig
): Promise<AuthClaims> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw errorResponse("missing bearer token", 401);
  }

  const token = authHeader.slice("Bearer ".length);
  const [header64, payload64, signature64] = token.split(".");
  if (!header64 || !payload64 || !signature64) {
    throw errorResponse("invalid JWT format", 401);
  }

  const header = parseJwtHeader(header64);
  const payload = parseJwtPayload(payload64);
  await verifyJwtSignature(header, header64, payload64, signature64, config);
  return validateClaims(payload, config);
}

export function requireAdminClaims(claims: AuthClaims): void {
  const hasAdminRole = claims.role === "admin";
  const hasAdminScope = claims.scopes?.includes("billing:read");

  if (!hasAdminRole && !hasAdminScope) {
    throw errorResponse("admin access required", 403);
  }
}

export function estimatePromptTokens(messages: Array<{ content: string }>): number {
  const totalChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  return Math.max(Math.ceil(totalChars / 4), 1);
}

export function estimateTextTokens(text: string): number {
  return Math.max(Math.ceil(text.length / 4), 1);
}

function parseJwtHeader(header64: string): JwtHeader {
  const header = JSON.parse(decodeBase64Url(header64)) as JwtHeader;
  if (!header.alg || typeof header.alg !== "string") {
    throw errorResponse("token missing alg header", 401);
  }
  return header;
}

function parseJwtPayload(payload64: string): Partial<AuthClaims> {
  return JSON.parse(decodeBase64Url(payload64)) as Partial<AuthClaims>;
}

async function verifyJwtSignature(
  header: JwtHeader,
  header64: string,
  payload64: string,
  signature64: string,
  config: AuthConfig
): Promise<void> {
  const signingInput = `${header64}.${payload64}`;
  const signature = base64UrlToBytes(signature64);

  if (SUPPORTED_SHARED_SECRET_ALGS.has(header.alg ?? "")) {
    const secrets = [config.jwtSecret, config.jwtSecretPrevious, config.jwtSecretNext].filter(
      (candidate): candidate is string => Boolean(candidate)
    );

    if (secrets.length === 0) {
      throw errorResponse("JWT shared-secret verification is not configured", 500);
    }

    for (const secretValue of secrets) {
      const secret = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secretValue),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"]
      );

      const valid = await crypto.subtle.verify(
        "HMAC",
        secret,
        toArrayBuffer(signature),
        new TextEncoder().encode(signingInput)
      );
      if (valid) {
        return;
      }
    }

    throw errorResponse("invalid JWT signature", 401);
  }

  if (SUPPORTED_JWKS_ALGS.has(header.alg ?? "")) {
    const jwksUrl = config.jwtJwksUrl;
    if (!jwksUrl) {
      throw errorResponse("JWT_JWKS_URL is not configured", 500);
    }
    if (!header.kid) {
      throw errorResponse("token missing kid header", 401);
    }

    const jwk = await getJwkForKid(jwksUrl, header.kid, config.jwtJwksCacheTtlSeconds);
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256"
      },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      toArrayBuffer(signature),
      new TextEncoder().encode(signingInput)
    );

    if (!valid) {
      throw errorResponse("invalid JWT signature", 401);
    }
    return;
  }

  throw errorResponse("unsupported JWT algorithm", 401);
}

function validateClaims(payload: Partial<AuthClaims>, config: AuthConfig): AuthClaims {
  const now = Math.floor(Date.now() / 1000);
  const clockSkewSeconds = parsePositiveInt(
    config.jwtClockSkewSeconds,
    DEFAULT_CLOCK_SKEW_SECONDS
  );

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw errorResponse("token missing subject claim", 401);
  }
  if (!VALID_TIERS.has(payload.tier as UserTier)) {
    throw errorResponse("token has invalid tier claim", 401);
  }
  if (
    typeof payload.budgetLimitCents !== "number" ||
    !Number.isFinite(payload.budgetLimitCents) ||
    payload.budgetLimitCents < 0
  ) {
    throw errorResponse("token has invalid budgetLimitCents claim", 401);
  }
  if (typeof payload.tenantId !== "string" || payload.tenantId.length === 0) {
    throw errorResponse("token missing tenantId claim", 401);
  }
  if (payload.role && !VALID_ROLES.has(payload.role)) {
    throw errorResponse("token has invalid role claim", 401);
  }
  if (payload.scopes && !isValidScopesClaim(payload.scopes)) {
    throw errorResponse("token has invalid scopes claim", 401);
  }
  if (payload.nbf && payload.nbf > now + clockSkewSeconds) {
    throw errorResponse("token not yet valid", 401);
  }
  if (payload.exp && payload.exp <= now - clockSkewSeconds) {
    throw errorResponse("token expired", 401);
  }
  if (payload.iat && payload.iat > now + clockSkewSeconds) {
    throw errorResponse("token issued in the future", 401);
  }
  if (config.jwtIssuer && payload.iss !== config.jwtIssuer) {
    throw errorResponse("token issuer mismatch", 401);
  }
  if (config.jwtAudience && !matchesAudience(payload.aud, config.jwtAudience)) {
    throw errorResponse("token audience mismatch", 401);
  }

  return {
    sub: payload.sub,
    tier: payload.tier as UserTier,
    budgetLimitCents: payload.budgetLimitCents,
    tenantId: payload.tenantId,
    role: payload.role,
    scopes: normalizeScopes(payload.scopes),
    iss: payload.iss,
    aud: payload.aud,
    jti: payload.jti,
    iat: payload.iat,
    exp: payload.exp,
    nbf: payload.nbf
  };
}

async function getJwkForKid(
  jwksUrl: string,
  kid: string,
  cacheTtlSeconds?: string
): Promise<JsonWebKey> {
  const now = Date.now();
  if (jwksCache && jwksCache.url === jwksUrl && jwksCache.expiresAt > now) {
    const cachedKey = jwksCache.keys.find((candidate) => candidate.kid === kid);
    if (cachedKey) {
      return cachedKey;
    }
  }

  const response = await fetch(jwksUrl, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw errorResponse("failed to fetch JWKS", 500);
  }

  const document = (await response.json()) as JwksDocument;
  const keys = (document.keys ?? []).filter(
    (candidate): candidate is JwkWithKid =>
      Boolean(candidate) &&
      candidate.kty === "RSA" &&
      typeof candidate.kid === "string"
  );

  jwksCache = {
    url: jwksUrl,
    expiresAt: now + parsePositiveInt(cacheTtlSeconds, DEFAULT_JWKS_CACHE_TTL_SECONDS) * 1000,
    keys
  };

  const key = keys.find((candidate) => candidate.kid === kid);
  if (!key) {
    throw errorResponse("no JWKS key matched token kid", 401);
  }

  return key;
}

function normalizeScopes(scopes: string[] | string | undefined): string[] | undefined {
  if (!scopes) {
    return undefined;
  }
  if (Array.isArray(scopes)) {
    return scopes;
  }
  return scopes.split(/\s+/).filter(Boolean);
}

function isValidScopesClaim(scopes: string[] | string): boolean {
  if (typeof scopes === "string") {
    return scopes.trim().length > 0;
  }
  return scopes.every((scope) => typeof scope === "string" && scope.length > 0);
}

function matchesAudience(
  actual: string | string[] | undefined,
  expectedList: string
): boolean {
  const expected = expectedList.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (expected.length === 0) {
    return true;
  }
  if (!actual) {
    return false;
  }
  const actualValues = Array.isArray(actual) ? actual : [actual];
  return expected.some((candidate) => actualValues.includes(candidate));
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
