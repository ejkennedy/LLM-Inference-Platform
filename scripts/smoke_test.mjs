import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:8790";
const repoRoot = resolve(import.meta.dirname, "..");
const jwtSecret = readJwtSecret(resolve(repoRoot, "workers/gateway/.dev.vars"));

if (!jwtSecret) {
  console.error("JWT secret not found. Run: npm run setup:local-auth");
  process.exit(1);
}

const token = createJwt(jwtSecret);

const health = await fetchJson(`${baseUrl}/health`);
assert(health.status === "ok", "gateway health check failed");

const usage = await fetchJson(`${baseUrl}/v1/usage`, token);
assert(typeof usage.budgetLimitCents === "number", "usage response missing budgetLimitCents");

const chatResponse = await fetch(`${baseUrl}/v1/chat`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    messages: [
      { role: "system", content: "You are concise." },
      { role: "user", content: "Say hello in one sentence." }
    ],
    model: "llama-3.1-8b",
    stream: true
  })
});

assert(chatResponse.ok, `chat request failed with status ${chatResponse.status}`);
const body = await chatResponse.text();
assert(body.includes("event: meta"), "SSE stream missing meta event");
assert(body.includes("event: token"), "SSE stream missing token event");
assert(body.includes("event: summary"), "SSE stream missing summary event");
assert(body.includes("data: [DONE]"), "SSE stream missing DONE frame");

console.log(`Smoke test passed for ${baseUrl}`);

function createJwt(secret) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
    "utf8"
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: "smoke-user",
      tier: "standard",
      budgetLimitCents: 500,
      tenantId: "smoke-tenant",
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

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: token
      ? {
          Authorization: `Bearer ${token}`
        }
      : undefined
  });
  assert(response.ok, `request to ${url} failed with status ${response.status}`);
  return response.json();
}

function readJwtSecret(path) {
  if (!existsSync(path)) {
    return undefined;
  }

  const line = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith("JWT_SECRET="));

  return line ? line.slice("JWT_SECRET=".length) : undefined;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
