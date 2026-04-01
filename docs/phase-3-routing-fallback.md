# Phase 3 Routing and External Fallback

Phase 3 is complete in the repo.

## Router Behaviour

The router now supports:

- requested-model routing
- free-tier capping
- budget-based fallback
- provider allowlists
- fallback chains that can cross provider boundaries

The default catalogue includes:

- `llama-3.1-8b`
- `llama-3.1-70b`
- `gpt-4.1-mini`

`llama-3.1-70b` can now fall back to `gpt-4.1-mini` when the active provider allowlist permits external models.

## External Provider Path

The gateway supports a generic OpenAI-compatible external provider adapter.

Runtime config:

- `EXTERNAL_PROVIDER_ENABLED=true`
- `EXTERNAL_PROVIDER_BASE_URL`
- `EXTERNAL_PROVIDER_API_KEY`
- `EXTERNAL_PROVIDER_PATH`
- `EXTERNAL_PROVIDER_MODEL_PREFIX`
- `EXTERNAL_PROVIDER_MAX_RETRIES`
- `EXTERNAL_PROVIDER_RETRY_BASE_MS`
- `EXTERNAL_PROVIDER_TIMEOUT_MS`
- `EXTERNAL_PROVIDER_CIRCUIT_FAILURE_THRESHOLD`
- `EXTERNAL_PROVIDER_CIRCUIT_COOLDOWN_SECONDS`

Default request target:

- `POST {EXTERNAL_PROVIDER_BASE_URL}/v1/chat/completions`

The adapter expects an OpenAI-style chat completions API shape for both JSON and SSE responses.

## Reliability Controls

The external provider adapter includes:

- response normalization for JSON and SSE
- bounded retries for transient `408`, `409`, `429`, and `5xx` failures
- a simple circuit breaker keyed by provider base URL

If the breaker opens, the gateway fails fast instead of repeatedly hammering the provider.
