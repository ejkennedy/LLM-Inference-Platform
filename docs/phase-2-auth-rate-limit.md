# Phase 2 Auth, Rate Limiting, and Budget Controls

This repo now treats Phase 2 as complete in code.

## JWT Verification Modes

The gateway supports two verification strategies:

- Shared-secret `HS256`
- Public-key `RS256` via JWKS

Runtime config:

- `JWT_SECRET`
- `JWT_SECRET_PREVIOUS`
- `JWT_SECRET_NEXT`
- `JWT_JWKS_URL`
- `JWT_ISSUER`
- `JWT_AUDIENCE`
- `JWT_CLOCK_SKEW_SECONDS`
- `JWT_JWKS_CACHE_TTL_SECONDS`

## Key Rotation Strategy

### Shared-secret rotation

1. Set the new secret as `JWT_SECRET_NEXT`
2. Start issuing new tokens with that secret
3. Promote it to `JWT_SECRET`
4. Keep the old primary in `JWT_SECRET_PREVIOUS` during the overlap window
5. Remove `JWT_SECRET_PREVIOUS` after the old tokens age out

This allows overlap without downtime.

### JWKS rotation

1. Publish the new key in the JWKS set with a new `kid`
2. Begin issuing tokens with the new `kid`
3. Keep the old key in the JWKS set until outstanding tokens expire
4. Remove the old key after the overlap window

The gateway caches JWKS documents for `JWT_JWKS_CACHE_TTL_SECONDS` and selects keys by `kid`.

## Claim Requirements

Accepted tokens must include:

- `sub`
- `tier`
- `budgetLimitCents`
- `tenantId`

Optional but supported:

- `role`
- `scopes`
- `iss`
- `aud`
- `jti`
- `iat`
- `nbf`
- `exp`

Additional checks now enforce:

- valid `tier`
- non-negative numeric `budgetLimitCents`
- non-empty `tenantId`
- issuer match when `JWT_ISSUER` is configured
- audience match when `JWT_AUDIENCE` is configured
- bounded clock skew

## Rate Limiter Lifecycle

The Durable Object now does more than count requests:

- reserves estimated spend per request
- reconciles actual spend per request
- stores a bounded recent billing ledger
- expires stale reservations
- drops old rate-limit minute buckets

Relevant runtime config:

- `RATE_LIMIT_REQUESTS_PER_MINUTE`
- `RATE_LIMIT_RESERVATION_TTL_SECONDS`
- `BILLING_LEDGER_LIMIT`

## Billing/Admin API

User endpoint:

- `GET /v1/usage`

Admin endpoint:

- `GET /v1/admin/usage?userId=<id>&limit=<n>`

Admin access requires either:

- `role=admin`
- or scope `billing:read`
