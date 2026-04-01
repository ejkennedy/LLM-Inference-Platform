# Phase 4 Streaming, Prompt Caching, and Prompt Registry

Phase 4 is complete in the repo.

## Streaming

The gateway-owned SSE contract now includes:

- `meta`
- `token`
- `usage`
- `summary`
- `[DONE]`

The streaming formatter now preserves:

- provider finish reasons
- request correlation headers
- cache/debug headers from AI Gateway when present

Readable upstream streams are cancelled when the downstream stream is cancelled.

## Semantic Caching via AI Gateway

The gateway now applies cache policy per request and per prompt:

- request-level `cacheControl`
- prompt-registry `cachePolicy`
- environment defaults

Relevant request fields:

- `cacheControl.bypass`
- `cacheControl.ttlSeconds`
- `cacheControl.promptClass`
- `cacheControl.userScoped`

Relevant gateway config:

- `AI_GATEWAY_ID`
- `AI_GATEWAY_ACCOUNT_ID`
- `AI_GATEWAY_TOKEN`
- `AI_GATEWAY_SKIP_CACHE`
- `AI_GATEWAY_CACHE_TTL`

When the HTTP AI Gateway path is active, the gateway forwards cache-debug headers such as:

- `cf-aig-cache-status`
- `x-cache-bypass`
- `x-cache-ttl-seconds`

## Prompt Registry

Reusable prompt templates are treated as versioned assets and resolved before inference.

Prompt seed data:

- `workers/gateway/prompt-registry.seed.json`

Prompt bootstrap command:

- `PROMPT_REGISTRY_NAMESPACE_ID=<id> npm run seed:prompts -- staging`
- `PROMPT_REGISTRY_NAMESPACE_ID=<id> npm run seed:prompts -- production`

Gateway request fields:

- `promptId`
- `promptVersion`

Resolved prompts are prepended as a system message before inference.
