# Build Plan Checklist

Status key:

- `[x]` Done in the repo
- `[-]` Partially done or scaffolded
- `[ ]` Not done yet

Source of truth: [cf_llm_build_plan.html](/Users/ethan/Dev/LLM-Inference-Platform/cf_llm_build_plan.html)

## Phase 1: Foundations & First Inference

- `[x]` Repo-owned Phase 1 implementation is complete
- `[-]` Cloudflare account-specific bindings, IDs, and environment values still need to be set in the target account

### Decision record + acceptance criteria
- `[x]` Thin vertical slice exists: gateway, router, observability, shared types
- `[x]` Shared contracts are defined and used across worker boundaries
- `[x]` Health endpoints exist for workers
- `[x]` Explicit written acceptance criteria document exists in `docs/phase-1-mvp.md`
- `[x]` Formal MVP scope document exists for the thin Phase 1 slice

### Repo + Wrangler setup
- `[x]` Monorepo structure exists for `gateway`, `router`, `observability`, and `shared/types`
- `[x]` Local dev scripts exist in the root `package.json`
- `[x]` Wrangler configs exist for all workers
- `[x]` Staging and production environment blocks exist in Wrangler configs
- `[x]` CI now runs install, test, build, and a local smoke gate for the Phase 1 slice
- `[-]` Some Cloudflare resources still rely on later manual configuration in real environments

### First Workers AI inference call
- `[x]` Gateway supports `POST /v1/chat`
- `[x]` Workers AI binding is wired for the gateway
- `[x]` Streaming responses work end to end
- `[x]` Request IDs are generated and returned
- `[x]` Local fallback mock response exists when AI binding is unavailable

### Model catalogue in KV
- `[x]` Router supports a model catalogue abstraction
- `[x]` Safe in-code default catalogue exists
- `[x]` KV-backed catalogue loading exists
- `[x]` Seed model catalogue data is committed in `workers/router/model-catalogue.seed.json`
- `[x]` Seed/bootstrap script exists for staging and production KV population
- `[-]` Real Cloudflare KV namespace creation and binding IDs still require account-specific setup

### Cloudflare AI Gateway integration
- `[x]` Optional AI Gateway integration exists in the gateway worker
- `[-]` Basic cache controls exist through `AI_GATEWAY_SKIP_CACHE` and `AI_GATEWAY_CACHE_TTL`, but no tuned semantic cache policy is committed
- `[x]` AI Gateway cache-control wiring is configurable in code and docs

## Phase 2: Authentication & Rate Limiting

- `[x]` Repo-owned Phase 2 implementation is complete
- `[-]` Production rollout still requires real issuer, audience, secrets, and optionally JWKS publication in the target identity system

### JWT auth middleware
- `[x]` Gateway requires bearer auth for protected endpoints
- `[x]` HS256 JWT verification exists
- `[x]` Local auth/dev token setup is documented and scripted
- `[x]` JWKS or public-key verification exists
- `[x]` Key rotation strategy exists in code/config for both HS256 and JWKS rollout
- `[x]` Claim-level validation covers issuer, audience, tenant, role, scopes, clock skew, and basic required claims

### Rate limiter with Durable Objects
- `[x]` Durable Object `RateLimiter` exists
- `[x]` Per-minute request limiting exists
- `[x]` Usage state can be queried with `/v1/usage`
- `[x]` Rate-limit denial returns `429`
- `[x]` The DO now cleans up expired reservations and old rate buckets and is documented for production lifecycle concerns

### Budget enforcement
- `[x]` Budget reservation state exists in the Durable Object
- `[x]` Spend reconciliation endpoint exists in the Durable Object flow
- `[x]` Gateway decrements estimated spend on chat requests
- `[x]` Budget denial returns `402`
- `[x]` A bounded billing ledger / reconciliation store exists inside the Durable Object
- `[x]` Admin billing API exists beyond the current user usage summary

## Phase 3: Model Router & Cost-Aware Fallback

### Router worker skeleton
- `[x]` Router is a separate worker
- `[x]` Gateway uses a service binding to call the router
- `[x]` Router request/response contract exists

### Routing rules & fallback chain
- `[x]` Requested-model resolution exists
- `[x]` Free-tier cap exists
- `[x]` Budget-based fallback exists
- `[x]` Routing reason codes are returned
- `[-]` Fallback logic currently targets the small in-code catalogue only

### External API fallback path
- `[ ]` External provider fallback is not implemented
- `[ ]` External provider secret management is not implemented
- `[ ]` Provider normalization/retry/circuit breaking is not implemented

## Phase 4: Streaming, SSE & Prompt Caching

### SSE streaming pipeline
- `[x]` Gateway streaming works end to end
- `[x]` Stable gateway-owned SSE contract exists now
- `[x]` Stream emits `meta`, `token`, `usage`, `summary`, `[DONE]`
- `[x]` Stream contract has tests
- `[-]` Upstream cancellation/backpressure handling is still minimal

### Semantic caching via AI Gateway
- `[ ]` Not implemented

### Prompt registry in KV or R2
- `[ ]` Not implemented

## Phase 5: Observability & Cost Metering

### Structured logging schema
- `[x]` Observability worker exists
- `[x]` Gateway publishes structured observation events
- `[x]` Request-linked telemetry path exists
- `[-]` Logging is basic and local; no mature redaction policy or downstream log platform config is committed

### Metrics export to Grafana Cloud
- `[x]` Analytics Engine binding support exists in the observability worker
- `[ ]` Grafana export job is not implemented
- `[ ]` Metrics dashboard provisioning is not implemented

### Cost dashboard & alerts
- `[ ]` No Grafana dashboard or alert definitions are committed
- `[ ]` No admin cost-summary endpoint beyond `/v1/usage`

## Phase 6: CI/CD, IaC & Production Hardening

### Terraform for Cloudflare resources
- `[ ]` Terraform is not implemented

### GitHub Actions deployment pipeline
- `[x]` CI workflow runs install, test, and build
- `[x]` Deploy workflow exists
- `[x]` Staging deployment lane exists
- `[x]` Production deployment lane exists
- `[x]` Post-deploy health smoke steps exist
- `[-]` Real deployment requires repository/environment secrets and Cloudflare resource setup

### Secret rotation & zero-downtime key updates
- `[-]` JWT rotation support exists in gateway config and docs, but broader platform secret rotation automation is not implemented

### Load testing & latency benchmarks
- `[ ]` Not implemented
- `[ ]` No benchmark results are committed

## Production Readiness Summary

### Done enough to run
- `[x]` Local development flow
- `[x]` Authenticated gateway
- `[x]` Router-based model selection
- `[x]` Durable Object rate limiting and budget tracking
- `[x]` Stable SSE contract
- `[x]` Unit tests
- `[x]` CI pipeline
- `[x]` CD workflow scaffold

### Highest-priority remaining work
- `[ ]` Configure real Cloudflare resources for KV, Durable Objects, Analytics, service bindings, and environments
- `[ ]` Add AI Gateway in front of inference
- `[ ]` Implement external provider fallback path
- `[ ]` Add smoke tests that run against deployed staging with environment-specific credentials
- `[ ]` Add real observability dashboards and alerts
- `[ ]` Add Terraform/IaC for Cloudflare resources
- `[ ]` Add load/performance testing and document real targets/results
