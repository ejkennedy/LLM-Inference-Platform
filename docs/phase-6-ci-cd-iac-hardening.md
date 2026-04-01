# Phase 6: CI/CD, IaC & Production Hardening

Phase 6 closes the remaining repo-owned operational gaps:

- Terraform scaffold for repeatable Cloudflare storage and environment naming
- manual JWT rotation workflow for zero-downtime shared-secret rollovers
- benchmark script and GitHub workflow for latency/error regression checks

## Terraform

The Terraform scaffold lives in `infra/terraform/`.

It currently manages:

- `MODEL_CATALOGUE` KV namespace
- `PROMPT_REGISTRY` KV namespace
- environment-specific worker naming and derived gateway URL outputs

Worker script bundling and deploy still stay on `wrangler deploy`, which is the cleaner path for this monorepo.

## JWT secret rotation

The workflow `.github/workflows/rotate-gateway-jwt.yml` expects these environment secrets:

- `JWT_SECRET_ACTIVE`
- `JWT_SECRET_PREVIOUS`
- `JWT_SECRET_NEXT`

It pushes:

- `JWT_SECRET`
- `JWT_SECRET_PREVIOUS`
- `JWT_SECRET_NEXT`

to the selected `gateway` environment and redeploys the worker.

Recommended rollout:

1. Put the future key in `JWT_SECRET_NEXT`
2. Issue new tokens with that key
3. Promote it to `JWT_SECRET_ACTIVE`
4. Move the old active key to `JWT_SECRET_PREVIOUS`
5. After token expiry passes, clear `JWT_SECRET_PREVIOUS`

## Benchmarks

The benchmark script is:

- `scripts/benchmark_gateway.mjs`

It measures:

- success/error counts
- p50/p95 TTFT
- p50/p95 total latency

The manual workflow is:

- `.github/workflows/benchmark.yml`

It uploads `benchmarks/report.json` as an artifact.

Default guardrails:

- p95 TTFT <= `5000ms`
- p95 total latency <= `15000ms`
- error rate <= `1%`

These should be tightened once production traffic is observed.
