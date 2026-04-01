# Phase 1 MVP Contract

Source plan: [cf_llm_build_plan.html](/Users/ethan/Dev/LLM-Inference-Platform/cf_llm_build_plan.html)

## Scope

Phase 1 is the narrowest end-to-end slice of the platform:

- One authenticated `POST /v1/chat` request path through `gateway` -> `router` -> Workers AI
- One stable SSE streaming contract owned by the gateway
- One primary model path with a small seeded catalogue
- One staging deployment target that can be verified with a smoke check

## Acceptance Gates

Phase 1 is complete when all of the following are true:

- `gateway`, `router`, and `observability` expose `GET /health`
- Shared request and response contracts are defined in `shared/types`
- `POST /v1/chat` returns a request ID and either a stable SSE stream or a JSON response
- Router-backed model resolution works with a seeded catalogue
- Gateway auth works for protected endpoints
- Local smoke validation can exercise `/health`, `/v1/usage`, and `/v1/chat`
- CI runs install, tests, build, and a smoke check
- Staging deploys can be smoke-checked via the public gateway URL

## Out Of Scope

The following items are intentionally not required to call Phase 1 complete:

- Multi-provider external fallback
- AI Gateway tuning beyond a basic on/off integration and cache controls
- Billing UI or admin dashboard
- Terraform-managed secrets and full infrastructure automation
- Production-grade JWKS auth and key rotation

## Repo Evidence

- Worker entrypoints: `workers/gateway`, `workers/router`, `workers/observability`
- Shared schemas: `shared/types/src/index.ts`
- Local smoke path: `scripts/smoke_test.mjs`
- CI workflow: `.github/workflows/ci.yml`
- CD workflow: `.github/workflows/deploy.yml`
- Seed catalogue: `workers/router/model-catalogue.seed.json`
