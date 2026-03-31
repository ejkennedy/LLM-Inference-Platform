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

3. Start the gateway worker in another shell.

```bash
npm run dev:gateway
```

4. Configure the gateway secret.

```bash
cd workers/gateway
wrangler secret put JWT_SECRET
```

5. Use an `HS256` JWT with claims shaped like:

```json
{
  "sub": "demo-user",
  "tier": "standard",
  "budgetLimitCents": 500,
  "tenantId": "demo-tenant",
  "exp": 1893456000
}
```

6. Generate a local dev token.

```bash
npm run token:dev -- your-local-secret demo-user standard 500
```

7. Call the gateway.

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

8. Inspect current usage state.

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

The suite covers router policy selection, JWT authentication helpers, and the Durable Object rate-limit and budget state machine.

## CI

The repo includes [ci.yml](/Users/ethan/Dev/LLM-Inference-Platform/.github/workflows/ci.yml) to run `npm ci`, `npm test`, and `npm run build` on pushes and pull requests.

## Remaining Gaps

- AI Gateway integration and external-provider fallback.
- Stronger JWT key management such as JWKS-based verification.
- CI smoke tests and deploy workflows.
