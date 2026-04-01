# Phase 6: CI/CD, IaC & Production Hardening

Phase 6 closes the remaining repo-owned operational gaps:

- Terraform scaffold for repeatable Cloudflare storage and environment naming
- manual JWT rotation workflow for zero-downtime shared-secret rollovers
- benchmark script and GitHub workflow for latency/error regression checks
- scheduled alert checks against the Analytics Engine-backed admin summary endpoint

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

## Scheduled alerts

The scheduled alert workflow is:

- `.github/workflows/observability-alerts.yml`
- `.github/workflows/verify-production.yml` for production-only end-to-end verification without deploys

It runs every 15 minutes and can also be dispatched manually for:

- `staging`
- `production`
- `all`

The checker script is:

- `scripts/check_alerts.mjs`

Required GitHub environment configuration:

- variable `GATEWAY_URL`
- secret `ALERT_JWT`

Optional GitHub environment configuration:

- variable `ALERT_TENANT_ID`
- variable `ALERT_WINDOW_HOURS`
- variable `ALERT_MAX_ACTUAL_COST_CENTS`
- variable `ALERT_MAX_ERROR_RATE`
- variable `ALERT_MAX_P95_TTFT_MS`
- variable `ALERT_MAX_P95_TOTAL_MS`
- secret `ALERT_WEBHOOK_URL`

Compatibility fallbacks:

- if `ALERT_JWT` is not set, the workflow falls back to `STAGING_SMOKE_JWT` or `PRODUCTION_SMOKE_JWT`
- if `GATEWAY_URL` is not set, the workflow falls back to `STAGING_GATEWAY_URL` or `PRODUCTION_GATEWAY_URL`

When thresholds are breached, the job fails and optionally sends a JSON webhook payload with a top-level `text` field.

## Production verification pipeline

The repo also includes:

- `.github/workflows/verify-production.yml`

It runs on a schedule and manual dispatch against the production gateway only.

Checks included:

- authenticated remote smoke suite
- alert threshold evaluation
- latency/error benchmark with artifact upload

Recommended production GitHub environment configuration:

- variable `GATEWAY_URL` or `PRODUCTION_GATEWAY_URL`
- secret `PRODUCTION_SMOKE_JWT` or `SMOKE_JWT`
- secret `ALERT_JWT`
- optional secret `BENCHMARK_JWT`
- optional benchmark threshold variables:
  - `BENCHMARK_REQUESTS`
  - `BENCHMARK_CONCURRENCY`
  - `BENCHMARK_THRESHOLD_P95_TTFT_MS`
  - `BENCHMARK_THRESHOLD_P95_TOTAL_MS`
  - `BENCHMARK_THRESHOLD_ERROR_RATE`
