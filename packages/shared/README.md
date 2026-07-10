# Shared — Zod Schemas, Primitives, and Error Codes

## Purpose

`@mercadoexpress/shared` provides the building blocks used by both backend and frontend:

- Zod schemas for request/response validation
- Domain value objects (Money, SKU, Quantity, etc.)
- Error code registry
- OpenAPI extensions

## Layout

```
src/
├── domain/
│   ├── money.ts          # Money value object (COP, no cents)
│   ├── sku.ts            # SKU value object [A-Za-z0-9]{6,20}
│   ├── quantity.ts       # Quantity (non-negative integer)
│   ├── reason.ts         # Movement/order reason (non-empty string)
│   ├── email.ts          # Email (RFC 5322)
│   ├── username.ts      # Username (3-30 chars)
│   ├── password-hash.ts # Password hash (bcrypt format)
│   ├── role.ts          # Role (only 'admin' in MVP)
│   ├── movement-type.ts # MovementType enum
│   ├── alert-status.ts  # AlertStatus enum (ACTIVA/RESUELTA)
│   ├── order-status.ts  # OrderStatus enum
│   └── category-name.ts # Category name (non-empty, unique)
├── schemas/
│   ├── common/
│   │   ├── error-envelope.ts      # Error response shape
│   │   ├── page.ts               # Paginated response wrapper
│   │   └── idempotency-key.ts    # UUID v4 validation
│   └── {auth,products,inventory,alerts,orders,categories}/
│       └── *.ts                  # Per-BC request/response schemas
├── errors/
│   └── errorCodes.ts            # Canonical error code registry
└── openapi/
    └── registry.ts              # Zod-to-OpenAPI extensions
```

## Error Codes

All error codes are defined in `errorCodes.ts`. Inline string literals are forbidden.

| Code                       | HTTP Status | Description                      |
| -------------------------- | ----------- | -------------------------------- |
| UNAUTHORIZED               | 401         | Missing or invalid JWT           |
| TOKEN_EXPIRED              | 401         | JWT has expired                  |
| INVALID_CREDENTIALS        | 401         | Wrong username/password          |
| RATE_LIMITED               | 429         | Too many requests                |
| VALIDATION_ERROR           | 422         | Request body validation failed   |
| NOT_FOUND                  | 404         | Resource not found               |
| FORBIDDEN                  | 403         | Action not allowed               |
| SKU_ALREADY_EXISTS         | 409         | SKU conflict                     |
| CATEGORY_NOT_FOUND         | 422         | Invalid category ID              |
| STOCK_WOULD_GO_NEGATIVE    | 422         | SALIDA would make stock negative |
| ORDER_QTY_BELOW_POLICY     | 422         | Quantity < 2 × stockMin          |
| ALERT_NOT_ACTIVE           | 422         | Alert is not in ACTIVA state     |
| ALERT_ALREADY_ACTIVE       | 409         | Alert already exists for product |
| ORDER_INVALID_TRANSITION   | 409         | Invalid status transition        |
| REJECTION_REASON_TOO_SHORT | 422         | Reason < 10 characters           |
| PRODUCT_NOT_FOUND          | 404         | Product not found                |
| INTERNAL_ERROR             | 500         | Unexpected server error          |
| IDEMPOTENCY_KEY_CONFLICT   | 409         | Duplicate idempotency key        |
| NETWORK_ERROR              | 503         | External service unavailable     |
| TIMEOUT                    | 504         | Request timed out                |

## Value Objects

### Money

```typescript
class Money {
  constructor(public readonly amount: number) // Integer (COP, no cents)
  toIntegerCOP(): number
  static fromCents(cents: number): Money
}
```

### SKU

```typescript
class SKU {
  constructor(public readonly value: string) // [A-Za-z0-9]{6,20}
}
```

### MovementType

```typescript
enum MovementType {
  ENTRADA = 'ENTRADA',
  SALIDA = 'SALIDA',
}
```

## Usage

### Backend

```typescript
import { ErrorCode } from '@mercadoexpress/shared';
import { createProductSchema } from '@mercadoexpress/shared/schemas/products';

// In handler
const result = createProductSchema.safeParse(req.body);
if (!result.success) {
  throw new ValidationError(ErrorCode.VALIDATION_ERROR, result.error);
}
```

### Frontend

```typescript
import { errorEnvelopeSchema } from '@mercadoexpress/shared';

// Type-safe error handling
const result = await fetch('/api/products');
const envelope = errorEnvelopeSchema.parse(await result.json());
```

## Scripts

```bash
pnpm --filter shared test          # Run tests
pnpm --filter shared type-check    # tsc --noEmit
```

## Architecture Rules

The `domain/` layer of shared MUST NOT import from any provider package (`*sdk*`, `*provider*`). This is enforced by:

- `packages/shared/test/architecture/no-domain-provider-imports.test.ts`
- ESLint boundaries plugin

## Dependencies

- `zod`: Schema validation
- `@asteasolutions/zod-to-openapi`: OpenAPI generation
