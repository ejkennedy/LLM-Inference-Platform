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

## CI

The repo includes [ci.yml](/Users/ethan/Dev/LLM-Inference-Platform/.github/workflows/ci.yml) to run `npm ci`, `npm test`, and `npm run build` on pushes and pull requests.

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

- AI Gateway integration and external-provider fallback.
- Stronger JWT key management such as JWKS-based verification.
- CI smoke tests and deploy workflows.
