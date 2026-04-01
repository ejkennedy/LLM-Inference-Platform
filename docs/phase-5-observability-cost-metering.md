# Phase 5: Observability & Cost Metering

Phase 5 turns the earlier telemetry stub into a usable observability layer.

## What is implemented

- The gateway now emits one final structured observation per request with:
  - `requestId`
  - `tenantId`
  - hashed user identity
  - resolved model
  - prompt and completion tokens
  - `ttftMs`
  - `totalMs`
  - estimated and actual cost
  - cache status and cache hit flag
  - routing reason and provider path
  - HTTP status class and finish reason
- The observability worker writes those events to Cloudflare Analytics Engine.
- The observability worker exposes internal summary endpoints for:
  - `/internal/cost-summary`
  - `/internal/metrics-summary`
  - `/internal/metrics/prometheus`
- The gateway now exposes admin-only `GET /v1/admin/cost-summary`.
- Grafana dashboard and alert provisioning artifacts live in `grafana/`.

## Internal query model

The observability worker stores one Analytics Engine row per request. The row layout is fixed in code:

- `blob1`: tenant id
- `blob2`: model
- `blob3`: routing reason
- `blob4`: provider path
- `blob5`: cache state (`hit` or `miss`)
- `blob6`: HTTP status class
- `blob7`: prompt id
- `blob8`: finish reason
- `double1`: prompt tokens
- `double2`: completion tokens
- `double3`: TTFT milliseconds
- `double4`: total milliseconds
- `double5`: estimated cost cents
- `double6`: actual cost cents
- `double7`: cache-hit numeric flag
- `double8`: error numeric flag
- `double9`: status code

## Required runtime configuration

The observability worker can always ingest events locally, but Analytics Engine queries require:

- `ANALYTICS_ACCOUNT_ID`
- `ANALYTICS_API_TOKEN`
- optional `ANALYTICS_DATASET` if you do not use the default `llm_requests`
- `METRICS_API_KEY` if you want to expose the public Prometheus scrape endpoint

Recommended token permission:

- `Account > Workers Analytics Engine > Read`

## Grafana Cloud path

The cleanest integration is:

1. Set `METRICS_API_KEY` on the observability worker.
2. Point a Prometheus-compatible scrape or Metrics Endpoint integration at:
   - `GET /metrics/prometheus`
3. Send the header:
   - `X-Metrics-Key: <METRICS_API_KEY>`
2. Import `grafana/llm-platform-dashboard.json`
3. Import `grafana/llm-platform-alerts.yaml`

The Prometheus payload contains:

- `llm_requests_total`
- `llm_actual_cost_cents`
- `llm_estimated_cost_cents`
- `llm_cache_hit_rate`
- `llm_error_rate`
- `llm_ttft_p95_ms`
- per-model variants such as `llm_model_actual_cost_cents`

Example production scrape URL:

- `https://llm-observability.<your-workers-subdomain>.workers.dev/metrics/prometheus`

## Freshness semantics

- `/v1/usage` is near-real-time user budget state from the Durable Object
- `/v1/admin/cost-summary` is near-real-time aggregated telemetry from Analytics Engine
- budget enforcement and cost-summary data should not be treated as invoice-grade accounting
