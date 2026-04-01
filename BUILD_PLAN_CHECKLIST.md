# Build Plan Checklist

Status key:

- `[x]` Done in the repo
- `[-]` Partially done or scaffolded
- `[ ]` Not done yet

Source of truth: [cf_llm_build_plan.html](/Users/ethan/Dev/LLM-Inference-Platform/cf_llm_build_plan.html)

## Phase 1: Foundations & First Inference

- `[x]` Repo-owned Phase 1 implementation is complete
- `[-]` Staging is now operationally validated end to end; production still needs its own Cloudflare account-specific bindings, IDs, secrets, and environment values

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
- `[x]` Staging Workers AI traffic has been validated through AI Gateway with the gateway-owned SSE contract

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

- `[x]` Repo-owned Phase 3 implementation is complete
- `[-]` Production rollout still requires real external-provider credentials, endpoint configuration, and per-provider operational tuning

### Router worker skeleton
- `[x]` Router is a separate worker
- `[x]` Gateway uses a service binding to call the router
- `[x]` Router request/response contract exists

### Routing rules & fallback chain
- `[x]` Requested-model resolution exists
- `[x]` Free-tier cap exists
- `[x]` Budget-based fallback exists
- `[x]` Routing reason codes are returned
- `[x]` Fallback logic spans the committed multi-provider catalogue and respects provider allowlists

### External API fallback path
- `[x]` External provider fallback is implemented
- `[x]` External provider secret/config management exists through gateway environment variables
- `[x]` Provider normalization, retries, and circuit breaking are implemented

## Phase 4: Streaming, SSE & Prompt Caching

- `[x]` Repo-owned Phase 4 implementation is complete
- `[-]` Production rollout still requires real AI Gateway account/token config and prompt-registry KV provisioning for managed assets

### SSE streaming pipeline
- `[x]` Gateway streaming works end to end
- `[x]` Stable gateway-owned SSE contract exists now
- `[x]` Stream emits `meta`, `token`, `usage`, `summary`, `[DONE]`
- `[x]` Stream contract has tests
- `[x]` Readable upstream cancellation and finish-reason preservation are implemented

### Semantic caching via AI Gateway
- `[x]` Request-aware AI Gateway cache control exists
- `[x]` Explicit cache bypass and TTL controls exist
- `[x]` Cache debug headers are surfaced when AI Gateway HTTP routing is active

### Prompt registry in KV or R2
- `[x]` Versioned prompt registry support exists in the gateway
- `[x]` Prompt seed assets are committed
- `[x]` Prompt registry bootstrap script exists

## Phase 5: Observability & Cost Metering

- `[x]` Repo-owned Phase 5 implementation is complete
- `[-]` Staging is now operationally validated end to end; production rollout still requires Cloudflare Analytics query credentials and live alert/webhook configuration

### Structured logging schema
- `[x]` Observability worker exists
- `[x]` Gateway publishes structured observation events
- `[x]` Request-linked telemetry path exists
- `[x]` Structured log schema now includes request, routing, latency, cost, and cache fields
- `[x]` User identifiers are hashed before log emission and raw prompt content is excluded by default

### Metrics export to Grafana Cloud
- `[x]` Analytics Engine binding support exists in the observability worker
- `[x]` Observability worker exposes internal summary and Prometheus-style metrics endpoints
- `[x]` Grafana dashboard provisioning artifact is committed
- `[x]` Grafana alert rules artifact is committed
- `[-]` Grafana remains optional; the repo now also includes a Cloudflare-native alerting path without external dashboard infrastructure

### Cost dashboard & alerts
- `[x]` Cost dashboard provisioning artifact is committed
- `[x]` Alert rule definitions are committed
- `[x]` Admin cost-summary endpoint exists beyond `/v1/usage`
- `[x]` Scheduled native alert-check workflow is committed

## Phase 6: CI/CD, IaC & Production Hardening

- `[x]` Repo-owned Phase 6 implementation is complete
- `[-]` Production rollout still requires live environment secrets, Terraform apply/import, and benchmark execution against the real deployment

### Terraform for Cloudflare resources
- `[x]` Terraform scaffold is implemented for Cloudflare KV namespaces and environment outputs
- `[x]` Environment example tfvars are committed
- `[-]` Terraform still needs to be applied or used to import already-created resources in the target account

### GitHub Actions deployment pipeline
- `[x]` CI workflow runs install, test, and build
- `[x]` Deploy workflow exists
- `[x]` Staging deployment lane exists
- `[x]` Production deployment lane exists
- `[x]` Post-deploy health smoke steps exist
- `[x]` Authenticated remote smoke checks exist for deployed environments
- `[x]` Scheduled observability alert checks exist for deployed environments
- `[-]` Real deployment still requires repository/environment secrets and Cloudflare resource setup

### Secret rotation & zero-downtime key updates
- `[x]` JWT rotation support exists in gateway config
- `[x]` Manual JWT secret rotation workflow is committed
- `[-]` Rotation still depends on GitHub environment secrets being managed correctly

### Load testing & latency benchmarks
- `[x]` Benchmark script is implemented
- `[x]` Manual benchmark workflow is committed
- `[-]` Real benchmark results still need to be generated and archived from the target environment

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
- `[x]` Staging deployment validated end to end with Auth0, AI Gateway, and usage accounting
- `[x]` Structured telemetry, aggregated cost summary, and dashboard artifacts
- `[x]` Staging observability and cost summary validated end to end with Analytics Engine
- `[x]` Native scheduled alerting path using the admin cost summary endpoint

### Highest-priority remaining work
- `[ ]` Finish production environment setup for KV, Durable Objects, Analytics, service bindings, and secrets
- `[ ]` Apply/import the Terraform scaffold against the production account
- `[ ]` Run and archive production benchmark results and tighten thresholds from observed traffic
- `[ ]` Configure production alert webhook/contact routing and verify the scheduled alert workflow
