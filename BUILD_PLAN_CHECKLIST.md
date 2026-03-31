# Build Plan Checklist

Status key:

- `[x]` Done in the repo
- `[-]` Partially done or scaffolded
- `[ ]` Not done yet

Source of truth: [cf_llm_build_plan.html](/Users/ethan/Dev/LLM-Inference-Platform/cf_llm_build_plan.html)

## Phase 1: Foundations & First Inference

### Decision record + acceptance criteria
- `[x]` Thin vertical slice exists: gateway, router, observability, shared types
- `[x]` Shared contracts are defined and used across worker boundaries
- `[x]` Health endpoints exist for workers
- `[-]` Explicit written acceptance criteria document is not separated as its own ADR/checklist artifact
- `[ ]` Formal MVP scope document or ADR set

### Repo + Wrangler setup
- `[x]` Monorepo structure exists for `gateway`, `router`, `observability`, and `shared/types`
- `[x]` Local dev scripts exist in the root `package.json`
- `[x]` Wrangler configs exist for all workers
- `[x]` Staging and production environment blocks exist in Wrangler configs
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
- `[-]` KV-backed catalogue loading exists, but no real KV namespace ID/data bootstrap is committed
- `[ ]` Real Cloudflare KV namespace provisioning and seeded model records

### Cloudflare AI Gateway integration
- `[ ]` AI Gateway is not integrated
- `[ ]` Semantic caching is not integrated
- `[ ]` AI Gateway logging/caching controls are not configured

## Phase 2: Authentication & Rate Limiting

### JWT auth middleware
- `[x]` Gateway requires bearer auth for protected endpoints
- `[x]` HS256 JWT verification exists
- `[x]` Local auth/dev token setup is documented and scripted
- `[-]` Auth is production-usable for shared-secret setups, but not ideal for multi-service/public-key production auth
- `[ ]` JWKS or public-key verification
- `[ ]` Key rotation strategy in code/config
- `[ ]` Claim-level validation beyond current basic shape/expiry checks

### Rate limiter with Durable Objects
- `[x]` Durable Object `RateLimiter` exists
- `[x]` Per-minute request limiting exists
- `[x]` Usage state can be queried with `/v1/usage`
- `[x]` Rate-limit denial returns `429`
- `[-]` The DO is functional, but not yet tuned/documented for production scaling and lifecycle concerns

### Budget enforcement
- `[x]` Budget reservation state exists in the Durable Object
- `[x]` Spend reconciliation endpoint exists in the Durable Object flow
- `[x]` Gateway decrements estimated spend on chat requests
- `[x]` Budget denial returns `402`
- `[-]` Spend accounting is still estimate-based around current provider flow and not audit-grade billing
- `[ ]` Strong billing ledger / reconciliation store
- `[ ]` Admin billing API beyond current usage summary

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
- `[ ]` Not implemented

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
- `[ ]` Replace HS256 local/shared-secret auth with JWKS or another production key-verification model
- `[ ]` Configure real Cloudflare resources for KV, Durable Objects, Analytics, service bindings, and environments
- `[ ]` Add AI Gateway in front of inference
- `[ ]` Implement external provider fallback path
- `[ ]` Add smoke tests that run against deployed staging with environment-specific credentials
- `[ ]` Add real observability dashboards and alerts
- `[ ]` Add Terraform/IaC for Cloudflare resources
- `[ ]` Add load/performance testing and document real targets/results
