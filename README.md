# LLM Inference Platform

Cloudflare Workers monorepo for a portfolio-grade LLM gateway. The current slice focuses on a clean edge request path: gateway entry, router-backed model resolution, Workers AI inference, SSE streaming, and structured telemetry hooks.

## Packages

- `workers/gateway`: public `/v1/chat` API, request IDs, SSE responses, and health checks.
- `workers/router`: model policy worker backed by KV with a safe in-code catalogue fallback.
- `workers/observability`: structured telemetry sink backed by Analytics Engine.
- `shared/types`: shared contracts for the worker boundary.

## Current MVP

- `GET /health` on each worker returns a lightweight health payload.
- `POST /v1/chat` accepts chat messages, resolves a model through the router worker, and streams Workers AI output.
- Streaming responses are normalized into gateway-owned SSE events: `meta`, `token`, `usage`, `summary`, then `[DONE]`.
- `GET /v1/usage` returns the authenticated user’s current minute request count and tracked budget state.
- Request IDs are generated at the edge and returned via `X-Request-Id`.
- A Durable Object-backed limiter enforces a simple per-user requests-per-minute guard.
- `Authorization: Bearer <jwt>` is required for chat and usage endpoints, using an `HS256` token verified with `JWT_SECRET`.
- The gateway emits lightweight request metadata to the observability worker through a Cloudflare service binding.
- The router supports free-tier model capping and simple budget-aware fallback.

## Getting Started

1. Install dependencies.

```bash
npm install
```

2. Start the router worker.

```bash
npm run dev:router
```

3. Start the observability worker if you want local telemetry handling.

```bash
npm run dev:observability
```

4. Start the gateway worker in another shell.

```bash
npm run dev:gateway
```

`router` and `observability` run cleanly in local `wrangler dev` without requiring real Cloudflare resource IDs. `gateway` also runs locally now. If the Workers AI binding is unavailable, the gateway returns a mock response in local dev.

5. Set up local auth once.

```bash
npm run setup:local-auth
```

This writes a local-only `workers/gateway/.dev.vars` file with `JWT_SECRET=...`.

6. Use an `HS256` JWT with claims shaped like:

```json
{
  "sub": "demo-user",
  "tier": "standard",
  "budgetLimitCents": 500,
  "tenantId": "demo-tenant",
  "exp": 1893456000
}
```

7. Generate a local dev token.

```bash
npm run token:dev
```

Or override the defaults:

```bash
npm run token:dev -- demo-user standard 500
```

For an admin token that can call billing endpoints:

```bash
npm run token:dev -- admin-user pro 500 admin billing:read
```

8. Call the gateway.

```bash
curl --no-buffer \
  -X POST http://127.0.0.1:8787/v1/chat \
  -H 'Authorization: Bearer <jwt>' \
  -H 'Content-Type: application/json' \
  -d '{
    "messages": [
      { "role": "system", "content": "You are concise." },
      { "role": "user", "content": "Explain edge inference in one sentence." }
    ],
    "model": "llama-3.1-8b",
    "stream": true
  }'
```

9. Inspect current usage state.

```bash
curl http://127.0.0.1:8787/v1/usage \
  -H 'Authorization: Bearer <jwt>'
```

10. Inspect admin billing state.

```bash
curl 'http://127.0.0.1:8787/v1/admin/usage?userId=demo-user&limit=10' \
  -H 'Authorization: Bearer <admin-jwt>'
```

11. Use a registered prompt template.

```bash
curl --no-buffer \
  -X POST http://127.0.0.1:8787/v1/chat \
  -H 'Authorization: Bearer <jwt>' \
  -H 'Content-Type: application/json' \
  -d '{
    "promptId": "concise-assistant",
    "promptVersion": "v1",
    "cacheControl": {
      "ttlSeconds": 120
    },
    "messages": [
      { "role": "user", "content": "Explain edge inference in one sentence." }
    ],
    "stream": true
  }'
```

## Build

```bash
npm run build
```

## Test

```bash
npm test
```

The suite covers router policy selection, JWT authentication helpers, SSE normalization, and the Durable Object rate-limit and budget state machine.

## Smoke Test

```bash
npm run smoke:local
```

This checks `/health`, `/v1/usage`, and `/v1/chat` against a running local gateway and validates the normalized SSE contract.

CI also runs:

```bash
npm run ci:smoke
```

That command boots the three workers locally on fixed ports and verifies the thin Phase 1 slice end to end.
The CI smoke gateway uses a dedicated `wrangler` `ci` environment without a live `AI` binding so the smoke path stays local and uses the built-in mock inference path.

## Router Catalogue Bootstrap

Seed data for the router catalogue lives in [model-catalogue.seed.json](/Users/ethan/Dev/LLM-Inference-Platform/workers/router/model-catalogue.seed.json).

To seed a real Cloudflare KV namespace once you have created it:

```bash
MODEL_CATALOGUE_NAMESPACE_ID=<namespace-id> npm run seed:catalogue -- staging
```

Or:

```bash
MODEL_CATALOGUE_NAMESPACE_ID=<namespace-id> npm run seed:catalogue -- production
```

This uses your existing `CLOUDFLARE_API_TOKEN` or `CF_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` or `CF_ACCOUNT_ID`.

## AI Gateway

The gateway supports optional Cloudflare AI Gateway routing while keeping direct Workers AI as the default path.

Configure any of these variables on the gateway worker to enable it:

- `AI_GATEWAY_ID`
- `AI_GATEWAY_SKIP_CACHE=true`
- `AI_GATEWAY_CACHE_TTL=120`

## External Provider Fallback

Phase 3 adds an OpenAI-compatible external provider fallback path. See [phase-3-routing-fallback.md](/Users/ethan/Dev/LLM-Inference-Platform/docs/phase-3-routing-fallback.md).

Relevant gateway variables:

- `EXTERNAL_PROVIDER_ENABLED=true`
- `EXTERNAL_PROVIDER_BASE_URL`
- `EXTERNAL_PROVIDER_API_KEY`
- `EXTERNAL_PROVIDER_PATH`
- `EXTERNAL_PROVIDER_MODEL_PREFIX`
- `EXTERNAL_PROVIDER_MAX_RETRIES`
- `EXTERNAL_PROVIDER_RETRY_BASE_MS`
- `EXTERNAL_PROVIDER_TIMEOUT_MS`
- `EXTERNAL_PROVIDER_CIRCUIT_FAILURE_THRESHOLD`
- `EXTERNAL_PROVIDER_CIRCUIT_COOLDOWN_SECONDS`

The external adapter expects an OpenAI-style `chat/completions` endpoint and supports both JSON and SSE responses.

## Streaming and Prompt Registry

Phase 4 adds request-aware cache controls and a versioned prompt registry. See [phase-4-streaming-cache-prompts.md](/Users/ethan/Dev/LLM-Inference-Platform/docs/phase-4-streaming-cache-prompts.md).

Prompt registry assets are seeded from [prompt-registry.seed.json](/Users/ethan/Dev/LLM-Inference-Platform/workers/gateway/prompt-registry.seed.json).

To seed a real Cloudflare KV namespace:

```bash
PROMPT_REGISTRY_NAMESPACE_ID=<namespace-id> npm run seed:prompts -- staging
```

Or:

```bash
PROMPT_REGISTRY_NAMESPACE_ID=<namespace-id> npm run seed:prompts -- production
```

## Auth Configuration

Phase 2 auth supports both shared-secret and JWKS verification. See [phase-2-auth-rate-limit.md](/Users/ethan/Dev/LLM-Inference-Platform/docs/phase-2-auth-rate-limit.md).

Relevant gateway variables:

- `JWT_SECRET`
- `JWT_SECRET_PREVIOUS`
- `JWT_SECRET_NEXT`
- `JWT_JWKS_URL`
- `JWT_ISSUER`
- `JWT_AUDIENCE`
- `JWT_CLOCK_SKEW_SECONDS`
- `JWT_JWKS_CACHE_TTL_SECONDS`
- `RATE_LIMIT_REQUESTS_PER_MINUTE`
- `RATE_LIMIT_RESERVATION_TTL_SECONDS`
- `BILLING_LEDGER_LIMIT`

## CI

The repo includes [ci.yml](/Users/ethan/Dev/LLM-Inference-Platform/.github/workflows/ci.yml) to run `npm ci`, `npm test`, `npm run build`, and the local smoke suite on pushes and pull requests.

## CD

The repo includes [deploy.yml](/Users/ethan/Dev/LLM-Inference-Platform/.github/workflows/deploy.yml) with this flow:

- Push to `main`: verify, then deploy `router` -> `observability` -> `gateway` to `staging`
- Release publish or manual dispatch: verify, then deploy `router` -> `observability` -> `gateway` to `production`

GitHub configuration expected by the workflow:

- Repository or environment secret: `CLOUDFLARE_API_TOKEN` or `CF_API_TOKEN`
- Repository or environment variable: `CLOUDFLARE_ACCOUNT_ID` or `CF_ACCOUNT_ID`
- Environment variable: `STAGING_GATEWAY_URL` such as `https://llm-gateway-staging.<your-subdomain>.workers.dev`
- Environment variable: `PRODUCTION_GATEWAY_URL` such as `https://llm-gateway.<your-subdomain>.workers.dev`
- GitHub environments: `staging` and `production`

## Remaining Gaps

- Production observability dashboards and alerts.
