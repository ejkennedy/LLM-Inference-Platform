# LLM Inference Platform

Monorepo scaffold for a Cloudflare Workers-based inference gateway.

## Packages

- `workers/gateway`: API gateway worker with auth, rate limiting, and model routing.
- `workers/router`: model router worker with cost-aware fallback logic.
- `workers/observability`: logging and metrics worker for structured telemetry.
- `shared/types`: shared request/response schemas and metadata types.

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Run a worker locally:

```bash
npm run dev:gateway
```

3. Build a package:

```bash
cd workers/gateway && npm run build
```
