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
- Request IDs are generated at the edge and returned via `X-Request-Id`.
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

4. Call the gateway.

```bash
curl --no-buffer \
  -X POST http://127.0.0.1:8787/v1/chat \
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

## Build

```bash
npm run build
```

## Next Slices

- JWT verification and tenant-aware policy enforcement in the gateway.
- Durable Object-backed rate limiting and budget reservation.
- AI Gateway integration, richer observability, and CI smoke tests.
