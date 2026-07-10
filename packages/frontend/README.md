# Frontend — Vue 3 SPA

## Stack

- **Framework:** Vue 3.5 + Composition API
- **Build:** Vite 5
- **State:** Pinia (composition-style stores)
- **Router:** Vue Router 4
- **Styling:** Tailwind CSS with oklch() tokens
- **HTTP:** ofetch
- **i18n:** vue-i18n 9 (Spanish es-CO primary, English fallback)
- **Testing:** Vitest + @vue/test-utils + @axe-core/playwright

## Layout (Atomic Design)

```
src/
├── components/
│   ├── atoms/          # Button, Input, Badge, AlertBadge, IconButton
│   ├── molecules/      # ProductFormField, MovementFormField, StatusBadge, PageHeader, FilterStrip
│   └── organisms/      # ProductTable, MovementHistoryTable, OrderTimeline, AlertCard, ConfirmDialog
├── templates/          # DashboardLayout, AuthLayout, OrderCreateLayout
├── pages/              # Route-level components (LoginPage, ProductsListPage, etc.)
├── stores/             # Pinia stores (useAuthStore, useProductsStore, etc.)
├── services/           # ofetch wrappers (auth, products, inventory, alerts, orders, categories)
├── router/             # Route definitions
├── i18n/               # Locale files (es-CO.json, en.json)
└── styles/             # tokens.css, tailwind.css
```

## Design System

### Color Tokens (oklch)

All colors use oklch() format. See `src/styles/tokens.css` for the full token set.

### Typography

- **Body:** Inter Variable (loaded via @fontsource-variable/inter)
- **Code/Mono:** JetBrains Mono Variable (loaded via @fontsource-variable/jetbrains-mono)

### Spacing Scale

4 / 8 / 12 / 16 / 24 / 32 / 48 px

### Radius

- Atoms: 6px
- Cards: 10px
- Modals: 16px

## Scripts

```bash
pnpm --filter frontend test              # Run tests
pnpm --filter frontend test:watch       # Watch mode
pnpm --filter frontend test:e2e         # Playwright e2e tests
pnpm --filter frontend build             # Production build
pnpm --filter frontend dev               # Vite dev server (port 5173)
pnpm --filter frontend type-check        # vue-tsc --noEmit
```

## Environment Variables

| Variable            | Description                                                            |
| ------------------- | ---------------------------------------------------------------------- |
| `VITE_API_BASE_URL` | API base URL (e.g., <https://xxx.execute-api.us-east-1.amazonaws.com>) |
| `VITE_STAGE`        | Deployment stage (dev/prod)                                            |

## Security Features

### Content Security Policy (RISK-W01)

`index.html` includes CSP meta tag restricting:

- `connect-src`: API Gateway only
- `script-src`: 'self'
- `frame-ancestors`: 'none'

### Per-Tab X-Request-Id (RISK-S06)

Each browser tab gets a UUID v4 stored in `useAuthStore().tabId`. All API requests include this as `X-Request-Id`.

### Idempotency (RISK-S07)

Mutating service calls generate a SHA-256 hash of the sorted JSON body and include it as `Idempotency-Key`.

## Key Stores

### useAuthStore

```typescript
interface AuthState {
  token: string | null;
  user: { username: string; role: 'admin' } | null;
  expiresAt: number | null;
  tabId: string; // Per-tab UUID
}
```

### useProductsStore

```typescript
interface ProductsState {
  items: Product[];
  page: number;
  size: number;
  total: number;
  filters: ProductFilters;
  loading: boolean;
  error: string | null;
}
```

## Routes

| Path                        | Component          |
| --------------------------- | ------------------ |
| `/login`                    | LoginPage          |
| `/productos`                | ProductsListPage   |
| `/productos/nuevo`          | ProductCreatePage  |
| `/productos/:id`            | ProductDetailPage  |
| `/productos/:id/movimiento` | RecordMovementPage |
| `/movimientos`              | MovementsListPage  |
| `/alertas`                  | AlertsListPage     |
| `/alertas/:id`              | AlertDetailPage    |
| `/ordenes`                  | OrdersListPage     |
| `/ordenes/nueva`            | OrderCreatePage    |
| `/ordenes/:id`              | OrderDetailPage    |
| `/categorias`               | CategoriesListPage |
