import crypto from "node:crypto";

const baseUrl = process.argv[2];

if (!baseUrl) {
  console.error("Usage: npm run smoke:remote -- <gateway-url>");
  process.exit(1);
}

const token = process.env.SMOKE_JWT ?? createJwtFromSecret(process.env.SMOKE_JWT_SECRET);

if (!token) {
  console.error("Missing SMOKE_JWT or SMOKE_JWT_SECRET");
  process.exit(1);
}

const health = await fetchJson(`${stripTrailingSlash(baseUrl)}/health`);
assert(health.status === "ok", "gateway health check failed");

const usageResponse = await fetch(`${stripTrailingSlash(baseUrl)}/v1/usage`, {
  headers: {
    Authorization: `Bearer ${token}`
  }
});
assert(usageResponse.ok, `usage request failed with status ${usageResponse.status}`);
const usage = await usageResponse.json();
assert(typeof usage.budgetLimitCents === "number", "usage response missing budgetLimitCents");

const chatResponse = await fetch(`${stripTrailingSlash(baseUrl)}/v1/chat`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    promptId: "concise-assistant",
    promptVersion: "v1",
    cacheControl: {
      ttlSeconds: 120
    },
    messages: [
      {
        role: "user",
        content: "Say hello in one sentence."
      }
    ],
    model: "llama-3.1-8b",
    stream: true
  })
});

assert(chatResponse.ok, `chat request failed with status ${chatResponse.status}`);
assert(chatResponse.headers.get("x-request-id"), "chat response missing x-request-id header");
const body = await chatResponse.text();
assert(body.includes("event: meta"), "SSE stream missing meta event");
assert(body.includes("event: token"), "SSE stream missing token event");
assert(body.includes("event: summary"), "SSE stream missing summary event");
assert(body.includes("data: [DONE]"), "SSE stream missing DONE frame");

console.log(`Remote smoke test passed for ${baseUrl}`);

function createJwtFromSecret(secret) {
  if (!secret) {
    return undefined;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
    "utf8"
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: "remote-smoke-user",
      tier: "standard",
      budgetLimitCents: 500,
      tenantId: "remote-smoke-tenant",
      iat: now,
      exp: now + 3600
    }),
    "utf8"
  ).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");

  return `${signingInput}.${signature}`;
}

async function fetchJson(url) {
  const response = await fetch(url);
  assert(response.ok, `request to ${url} failed with status ${response.status}`);
  return response.json();
}

function stripTrailingSlash(value) {
  return value.replace(/\/$/, "");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
