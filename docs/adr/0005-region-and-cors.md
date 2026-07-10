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

## Consequences

### Positive

- **Security**: CloudFront origin is the only allowed source.
- **Performance**: Single region simplifies latency calculations.

### Negative

- **No multi-region HA**: A region outage affects the entire system.

## References

- Risk: RISK-002
- Design: `design.md` §2.1, §9.3
