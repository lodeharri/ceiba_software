# Categories Specification

## Purpose

The `categories` bounded context owns the lookup table that the `products`
BC references via `categoryId`. `Categoria` is a lookup table with a FK
(orchestrator-locked D2) rather than an enum string, so operations can add
new categories without a migration. The frontend has NO UI surface for
categories in this change; the API exists for ops and for the seed
bootstrap. Out of scope: category hierarchies, soft delete, multi-language
names.

## Domain primitives

| Primitive                   | Owned here | Notes                               |
| --------------------------- | ---------- | ----------------------------------- |
| `Category` (aggregate root) | yes        | id (UUID), name (unique), createdAt |
| `CategoryName` (VO)         | yes        | 2-40 chars, unique across rows      |

> Categories are referenced by `products.spec.md` via `categoryId` (FK).
> The reference data bootstrap in [`shared/spec.md`](../shared/spec.md)
> inserts the six reference categories.

## Requirements

### Requirement: List categories (id, name)

The system MUST accept `GET /api/v1/categories?page=&size=` and MUST return
the standard `Page<Category>` shape from `shared/spec.md`, ordered by
`name ASC`. This route is protected by the JWT middleware; no admin role
check beyond authentication is required.

#### Scenario: Default list

- GIVEN the six reference categories seeded
- WHEN `GET /api/v1/categories` is called
- THEN the response is `200` with `items.length = 6`, ordered by `name`:
  Bebidas, Frutas, Granos, Lácteos, Limpieza, Snacks

#### Scenario: Missing token

- GIVEN a request without `Authorization`
- WHEN the controller is hit
- THEN the response is `401` with `code = "UNAUTHORIZED"`

### Requirement: Create category (authenticated)

The system MUST accept `POST /api/v1/categories` with
`{ name: string }` where `name` is 2-40 chars and unique, and MUST return
`201` with the persisted category. On duplicate name the response is `409`
with `code = "CATEGORY_NAME_EXISTS"`.

#### Scenario: Create new category

- GIVEN a request body `{ name: "Congelados" }`
- WHEN `POST /api/v1/categories` is called
- THEN the response is `201` with the persisted category body including
  its server-assigned UUID `id`

#### Scenario: Duplicate name

- GIVEN a category named "Bebidas" already exists
- WHEN `POST /api/v1/categories` is called with `{ name: "Bebidas" }`
- THEN the response is `409` with `code = "CATEGORY_NAME_EXISTS"`,
  `message = "Ya existe una categoría con el nombre 'Bebidas'."`,
  `details = { name: "Bebidas", existingCategoryId: "<id>" }`

#### Scenario: Name too short

- GIVEN a request body `{ name: "X" }` (length 1)
- WHEN Zod validates
- THEN the response is `400` with `code = "VALIDATION_ERROR"` and the field
  path `name` flagged

### Requirement: Reference seed inserts the six categories

The seed bootstrap (see `shared/spec.md`) MUST upsert exactly the six
reference categories from `porject.md → Datos de Referencia`:
`Bebidas`, `Lácteos`, `Snacks`, `Limpieza`, `Frutas`, `Granos`.

#### Scenario: First deploy

- GIVEN a fresh `categories` table
- WHEN the seed Lambda runs
- THEN exactly six rows exist after completion with the names listed above

#### Scenario: Re-deploy (idempotency)

- GIVEN the six categories are already present
- WHEN the seed Lambda runs again
- THEN no duplicates are created; the existing rows are preserved

### Requirement: No UI surface for categories in this change

The frontend MUST NOT expose a categories management page in this change.
Categories are managed via the API + seed only; the products SPA simply
loads the list for the product form's category dropdown.

#### Scenario: No route in router

- GIVEN `packages/frontend/src/router/`
- WHEN routes are enumerated
- THEN no route maps to a categories list / create / edit page

## Acceptance scenario summary

| Story          | Pass condition                                             |
| -------------- | ---------------------------------------------------------- |
| Reference data | The six categories are present after every fresh seed      |
| Lookup read    | `GET /categories` returns the list in `name ASC` order     |
| Ops write      | `POST /categories` is gated by JWT and enforces uniqueness |

## Out of scope for this change

- Category hierarchies (parent / child).
- Soft delete / archive (a deletion in MVP would orphan products).
- Multi-language `name` (single Spanish name only).
- Category icon / color / order fields.
- Edit endpoint (`PATCH /categories/{id}`) — ops can re-seed with the
  corrected name when needed.
- Public unauthenticated read (every categories route requires JWT for
  consistency with the rest of the API).
