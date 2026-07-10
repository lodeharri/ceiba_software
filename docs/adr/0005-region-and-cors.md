# ADR-0005: Region and CORS Configuration

## Status

Accepted

## Context

The application is deployed in a single AWS region (`us-east-1`). The SPA is hosted on CloudFront with an S3 origin. CORS must be configured correctly to allow SPA-to-API communication.

The risk review identified RISK-002: CORS misconfiguration can block legitimate requests.

## Decision

### Region

- Single region: `us-east-1`
- No multi-region active-active deployment in MVP

### CORS Configuration

API Gateway HTTP API v2 with explicit CORS preflight:

- `allowOrigins`: `https://${distributionDomainName}` (CloudFront domain only)
- `allowMethods`: GET, POST, PATCH, OPTIONS
- `allowHeaders`: Content-Type, Authorization, X-Request-Id, Idempotency-Key
- `maxAge`: 3600 seconds (1 hour)
- `allowCredentials`: false

## Alternatives Considered

### Multi-region active-active deployment

Replicate to `us-west-2` with active-active failover — doubles infra cost and adds cross-region DB replication complexity that the MVP does not require.

### Wildcard CORS origin (`*` or broad CloudFront suffix)

Would accept requests from any origin including unrelated distributions — expands the attack surface unnecessarily; rejected for the same RISK-002 reason as the explicit allow-list.

### `allowCredentials: true` with cookie-based auth

Simplifies browser auth but introduces CSRF concerns and forces credentialed preflights on every cross-origin call.

## Consequences

### Positive

- **Security**: CloudFront origin is the only allowed source.
- **Performance**: Single region simplifies latency calculations.

### Negative

- **No multi-region HA**: A region outage affects the entire system.

## References

- Risk: RISK-002
- Design: `design.md` §2.1, §9.3
