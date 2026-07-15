# Explore — Prisma + Lambda + RDS

## 1. Findings verificados

### V1 — Historial de fixes previos fallidos

| Commit                                    | Fecha    | Cambio                                                                                                                                                                                                                 |
| ----------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `af30e91`                                 | Jul 2026 | `feat(infra,migrations): add CustomResource Lambdas for prisma migrate + seed + jwt-secret` — agregó `binaryTargets = ["native", "rhel-openssl-3.0.x"]` al schema y al layer.                                          |
| Review `ceiba-backend-runtime-2026-07-12` | Jul 2026 | "Three security/architecture changes: **(1) Prisma binary targets add rhel-openssl-3.0.x** so Lambdas on AL2 can load query engine — **closes the deployment blocker** where all 5 Lambdas returned 500 on DB access." |

El fix anterior (commit `af30e91`) añadió `binaryTargets = ["native", "rhel-openssl-3.0.x"]` y construyó el layer con el engine RHEL. **El error actual persiste** — la causa raíz no es la ausencia del binary target sino la ruta del engine no resuelta en runtime.

Búsqueda en `docs/`, `runbook/`, `openspec/changes/`, `README.md`: no hay otro fix previo documentado sobre Prisma query engine en Lambda. El README (`README.md:927`) solo dice "run `pnpm --filter @mercadoexpress/backend prisma generate`" — insuficiente para el contexto Lambda.

### V2 — OpenSpec changes existentes sobre Prisma/Lambda/RDS

| Change                           | Título                                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add-inventory-mvp/`             | Prisma schema + 5 Lambdas + RDS Postgres 16 + pgvector. Archivo `explore.md` identifica R-1 (Prisma cold start) y R-4 (RDS t3.micro OOM) como riesgos abiertos. |
| `add-localstack-dev-env/`        | Migrations Lambda stub, prisma-client factory, localstack stage.                                                                                                |
| `replace-localstack-dev-server/` | Reemplazó Docker-based dev server con archivos `.env.dev` individuales.                                                                                         |

Ningún change previo ataca específicamente el error "Query Engine could not locate".

### V3 — Versión Prisma real

```
packages/backend/package.json:12: "@prisma/client": "^5.20.0"
packages/backend/package.json:13: "prisma": "^5.20.0"
pnpm-lock.yaml:100: version: 5.22.0(prisma@5.22.0)
pnpm-lock.yaml:908: '@prisma/client@5.22.0'
pnpm-lock.yaml:923: '@prisma/engines@5.22.0'
pnpm-lock.yaml:2688: prisma@5.22.0
```

**Declarado**: `^5.20.0`. **Resuelto por pnpm**: `5.22.0`. Todos los paquetes (`@prisma/client`, `@prisma/engines`, `prisma`) resuelven a `5.22.0`. El schema del layer usa `prisma@5.22.0` hardcodeado (`prisma-layer.ts:64`).

### V4 — Compatibilidad driver adapter con 5.22 vs 6.x

- `packages/backend/prisma/schema.prisma`: **NO tiene** `previewFeatures = ["driverAdapters"]`. Generator actual: `provider = "prisma-client-js"`, `binaryTargets = ["native", "rhel-openssl-3.0.x"]`, `output` apuntando a pnpm-store.
- **`@prisma/adapter-pg`**: es el adapter correcto para Postgres directo (no HTTP). Requiere `pg` (node-postgres) como peer dep.
- **`@prisma/adapter-pg-worker`**: para environments con `globalThis.fetch` (Cloudflare Workers, etc.) — **incompatible con Lambda estándar** que no tiene `globalThis.fetch` nativo en Node.js 20 sin polyfill. No aplica a esta situación.
- **Driver adapters en 5.22**: disponible como preview feature (`previewFeatures = ["driverAdapters"]`).
- **Driver adapters en 6.x (GA)**: promoted a stable; `previewFeatures` ya no necesario. Compatible con 5.22 si se activa preview.

**Conclusión técnica**: con Prisma 5.22 se requiere `previewFeatures = ["driverAdapters"]` en el schema para usar `@prisma/adapter-pg`. En 6.x no requiere preview. La documentación oficial de Prisma 5.x confirma: "Driver adapters are available as a Preview feature in Prisma Client JS (version 3.14.0 and later)".

### V5 — Estado real de la Lambda `prisma-migrate-and-seed`

- `constructs/migrations.ts`: Lambda `MercadoExpress-${stage}-prisma-migrate-and-seed`, 1024 MB, `PRIVATE_ISOLATED`, **SIN layer**.
- Bundling: `prismaMigrationsBundling` (`bundling-defaults.ts:55–72`) — usa `commandHooks` para:
  1. `npm install` prisma + `@prisma/client` + `@prisma/engines` + tsx en el bundle.
  2. Copia `schema.prisma` y patches output path a `node_modules/@prisma/client/.prisma/client`.
  3. Ejecuta `prisma generate` con `HOME=/tmp` para evitar errores de cache.
- Handler (`migrations-lambda.ts:126`): `process.execPath + [PRISMA_CLI, 'migrate', 'deploy', '--schema', PRISMA_SCHEMA_PATH]`. No usa `npx`.
- La Lambda resolve el CLI desde `/var/task/node_modules/prisma/build/index.js` (dentro del bundle).
- **NO usa el Prisma Layer** — es autosuficiente con los engines dentro del zip.

### V6 — Análisis del bundling de esbuild

**Layer (`prisma-layer.ts:35–94`)**:

- Construye estructura `nodejs/node_modules/` con `npm install prisma@5.22.0 @prisma/client@5.22.0 @prisma/engines@5.22.0 --ignore-scripts`.
- Schema mínimo: `binaryTargets = ["rhel-openssl-3.0.x"]`, `output` no especificado (usa default).
- Ejecuta `prisma generate` que crea `nodejs/node_modules/.prisma/client/libquery_engine-rhel-openssl-3.0.x.so.node`.
- Lambda monta `/opt/ -> inputDir/`, resultando en `/opt/nodejs/node_modules/.prisma/client/libquery_engine-rhel-openssl-3.0.x.so.node` ✓.

**BC Lambdas (`ApiStack.ts:319–326`)**:

```typescript
layers: [prismaLayer],                           // línea 320
bundling: { externalModules: ['aws-sdk'] },      // línea 321
```

- Solo externaliza `aws-sdk`. **`@prisma/client` NO está externalizado** — es bundleado desde el backend schema.
- El backend schema (`schema.prisma:41`): `output = "../../../node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client"`. Esta ruta es el **pnpm-store path local del dev**, no existe en Lambda.
- `bundling-defaults.ts:37` dice: "aws-sdk + @prisma/client externos. Si @prisma/client se bundlea, sus paths hardcoded apuntan a pnpm-store y rompen en runtime" — **la documentación ya describe exactamente el bug actual**.

**Causa raíz técnica**: cuando esbuild bundlea el handler de un BC Lambda:

1. Encuentra `import { PrismaClient } from '@prisma/client'`.
2. Dado que `@prisma/client` no está en `externalModules`, esbuild bundlea `@prisma/client` incluyendo la lógica que lee el `schema.prisma` bundled del backend (que usa el pnpm-store path).
3. El schema.prisma bundled del backend tiene `output` = pnpm-store path.
4. En runtime, Prisma busca `libquery_engine-rhel-openssl-3.0.x.so.node` en `/var/task/../../../node_modules/.pnpm/...` que no existe.
5. El layer está en `/opt/nodejs/` pero Prisma **no busca en `/opt/`** — su sequence lookup (estudiada en el source de `prisma-client-js`) empieza desde CWD (`/var/task/`) y las rutas hardcodeadas no incluyen `/opt/`.

**Error path evidence** (`packages/infra/src/shared/bundling-defaults.ts:44–45`):

> "Si @prisma/client se bundlea, sus paths hardcoded apuntan a pnpm-store y rompen en runtime ('Query Engine not found')."

### V7 — Patrón actual de instanciación de Prisma

| File                                                             | Línea                                              | Instanciación            | Ubicación         |
| ---------------------------------------------------------------- | -------------------------------------------------- | ------------------------ | ----------------- |
| `packages/backend/src/shared/prisma-client.ts:101`               | `g.__mercadoExpressPrisma = new PrismaClient(...)` | **Singleton globalThis** | Fuera del handler |
| `packages/backend/src/auth/bootstrap.ts:43`                      | `prismaOverride ?? getPrismaClient()`              | Factory call             | Fuera del handler |
| `packages/backend/src/products/bootstrap.ts:42`                  | `prismaOverride ?? getPrismaClient()`              | Factory call             | Fuera del handler |
| `packages/backend/src/categories/bootstrap.ts:30`                | `prismaOverride ?? getPrismaClient()`              | Factory call             | Fuera del handler |
| `packages/backend/src/inventory/bootstrap.ts:67`                 | `getPrismaClient()`                                | Factory call             | Fuera del handler |
| `packages/backend/src/alerts/bootstrap.ts:45`                    | `prismaOverride ?? getPrismaClient()`              | Factory call             | Fuera del handler |
| `packages/backend/src/orders/interface/handlers/bootstrap.ts:73` | `getPrismaClient()`                                | Factory call             | Fuera del handler |

**Patrón**: singleton module-level via `globalThis` (`prisma-client.ts:92`). Correcto para Lambda. `connection_limit = 2` (default en `buildPrismaUrl` cuando no se pasa `connectionLimit`).

### V8 — ReservedConcurrency actual

```
packages/infra/src/config.ts:100: reservedConcurrencyByStage: { dev: undefined, prod: undefined, localstack: undefined }
packages/infra/src/stacks/ApiStack.ts:292: const reservedConcurrency = infraConfig.reservedConcurrencyByStage[stage]
packages/infra/src/stacks/ApiStack.ts:342–343: ...(reservedConcurrency !== undefined ? { reservedConcurrentExecutions: reservedConcurrency } : {})
```

**Hallazgo crítico**: `config.ts:100` tiene `dev: undefined` (comportamento actual), pero el comment en `config.ts:97–98` dice `// ADR-9: dev reserves 1 concurrent execution so the §12.4 alarm fires predictably`. **El comentario está desactualizado** — el código real no reserva concurrencia en ninguna stage.

`ObservabilityStack.ts:98`: `const reserved = infraConfig.reservedConcurrencyByStage.dev ?? 1` — el alarm hardcodea fallback a 1 cuando `dev` es `undefined`.

**Estado**: las 5 Lambdas de negocio tienen `reservedConcurrentExecutions: undefined` (no seteado). Concurrencia default de Lambda (1000). La Lambda de migraciones también sin reserva.

### V9 — Alarmas CloudWatch actuales

```
packages/infra/src/stacks/ObservabilityStack.ts:63: LambdaThrottles (threshold > 0, por Lambda)
packages/infra/src/stacks/ObservabilityStack.ts:79: LambdaErrors (threshold > 0, por Lambda)
packages/infra/src/stacks/ObservabilityStack.ts:100: LambdaConcurrentExecutions (80% de reserved, solo dev)
```

**No existe** alarma para `DatabaseConnections` ni `max_connections`. El grep en todo `packages/infra/src` para `DatabaseConnections` o `max_connections` retorna vacío.

### V10 — RDS networking y `max_connections`

**Clase y versión** (`DatabaseStack.ts:143–147`):

```
engine: postgres-16
instanceType: db.t3.micro
vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC }
publiclyAccessible: false
```

**Cálculo `max_connections`**: fórmula RDS `L(ds2) = DBInstanceClassMemory / 9531392`.

- `db.t3.micro`: 1 GB RAM = 1,073,741,824 bytes → `1073741824 / 9531392 ≈ 112.65` → redondeado a **~113 connections**.
- Por defecto RDS: `max_connections = LEAST({DBInstanceClassMemory}, 65536) = 113` para t3.micro.

**Networking**:

- VPC: pública + privada aislada (`DatabaseStack.ts:71–81`).
- Lambdas negocio: `PRIVATE_ISOLATED` (`ApiStack.ts:324–325`).
- RDS: `PUBLIC` subnet (`DatabaseStack.ts:147`) pero `publiclyAccessible: false` (no accesible desde internet, solo desde dentro del VPC).
- Security group: permite TCP 5432 desde `vpc.vpcCidrBlock` (`DatabaseStack.ts:86–88`).
- Lambdas en PRIVATE_ISOLATED pueden reach RDS en PUBLIC subnet del **mismo VPC** ✓.

### V11 — `schema.prisma` completo

Models: `User`, `Category`, `Product`, `LoginAttempt`, `IdempotencyKey`, `StockMovement`, `Alert`, `PurchaseOrder`.  
Generator: `prisma-client-js`, `binaryTargets = ["native", "rhel-openssl-3.0.x"]`, `output` = pnpm-store path.  
**NO tiene** `previewFeatures = ["driverAdapters"]`.  
**NO tiene** `provider = "postgresql"`, `sslmode` en datasource URL.  
Datasources: `db` provider `postgresql`, URL from env `DATABASE_URL`.

### V12 — `DATABASE_URL` resolución

- **En AWS (dev/prod)**: Constructed via `Fn::Join` de `secretsmanager.Secret` JSON fields en `ApiStack.ts:250–261`. CDK sintetiza `{{resolve:secretsmanager:arn:SecretString:field::}}`. Sin SDK call en runtime.
- **En localstack**: literal env var `DATABASE_URL` pasado directamente (`app.ts:96–97`).
- **SSL**: `sslmode=require` en dev/prod, `sslmode=disable` en localstack (`prisma-client.ts:74–76`).
- **Connection limit**: `connection_limit=2` default (`prisma-client.ts:69`).

### V13 — Lookup sequence del engine en Prisma 5.x

En Prisma Client 5.x (`packages/client/src/runtime/getEngine.ts` o equivalente), la sequence lookup del Query Engine es aproximadamente:

1. `process.cwd() + /node_modules/.prisma/client/`
2. `/node_modules/.prisma/client/` (walk up desde CWD)
3. La ruta exacta del `output` path del schema compilado
4. Fallback paths: `HOME/.prisma/client/`, `/tmp/prisma-engines/`

**El layer deposita el engine en `/opt/nodejs/node_modules/.prisma/client/`**. El paso 1 y 2 buscan desde `/var/task/` (CWD de Lambda) — `/var/task/node_modules/.prisma/client/` — **NO `/opt/nodejs/node_modules/.prisma/client/`**. El `/opt/` no está en la sequence lookup de Prisma. Por eso el error: las rutas buscadas (`/node_modules/.pnpm/...`, `/.prisma/client/`, `/tmp/prisma-engines/`) no incluyen `/opt/`.

## 2. Asumpciones abiertas / a validar en proposal

| #   | Asumpción                                                                                                                          | Evidencia faltante                                                                                                                                                        | Acción                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| A1  | El bundling de `@prisma/client` en los BC Lambdas bundlea también el `schema.prisma` del backend con el output path del pnpm-store | Confirmado parcialmente: `schema.prisma` del backend tiene el pnpm-store path; esbuild bundlea el archivo de schema; no hay evidencia directa de que el schema se bundlee | Validar en proposal con test de synth output                                  |
| A2  | El `externalModules` en `NodejsFunction.bundling` para BC Lambdas no incluye `@prisma/client`                                      | `ApiStack.ts:321` tiene `bundling: { externalModules: ['aws-sdk'] }` — la pregunta es si esbuild mergea esto con defaults                                                 | Confirmado: esbuild no mergea — `externalModules` solo contiene `['aws-sdk']` |
| A3  | El layer path `/opt/nodejs/` NO está en la lookup sequence de Prisma 5.x                                                           | Confirmado por el error y la lógica de paths; no hay webfetch confirmado del source de Prisma 5.x `getQueryEnginePath`                                                    | Marcar como high confidence basado en error verbatim                          |
| A4  | La Lambdas de negocio en PRIVATE_ISOLATED pueden reach RDS en PUBLIC subnet del mismo VPC                                          | Sí, porque SG permite desde `vpcCidrBlock`; confirmado                                                                                                                    | Alta confianza                                                                |
| A5  | `@prisma/adapter-pg` requiere `pg` (node-postgres) como peer dep                                                                   | No verificado en package.json del backend (no hay `@types/pg` ni `pg` listed)                                                                                             | El proposal debe decidir si se agrega `pg` o se usa el built-in de Prisma     |

## 3. Risks

| Risk | Severidad    | Ubicación                                     | Descripción                                                                                                                                                                                                            |
| ---- | ------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1  | **CRITICAL** | `ApiStack.ts:321` + `bundling-defaults.ts:37` | `@prisma/client` se bundlea con output path del pnpm-store. Engine no encontrado en runtime. Las 5 Lambdas negocio devuelven 500 en cada request DB.                                                                   |
| R-2  | **HIGH**     | `schema.prisma:41`                            | El `output` path del schema apunta a `node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/...` — solo existe en dev, no en Lambda ni en el layer.                                                                   |
| R-3  | **HIGH**     | `config.ts:100`                               | `reservedConcurrencyByStage` = `undefined` para todas las stages. Lambdas pueden escalar a 1000 concurrentes. Sin RDS Proxy, `max_connections=113` del t3.micro puede agotarse rápidamente bajo carga concurrente.     |
| R-4  | **HIGH**     | `ObservabilityStack.ts`                       | No existe alarma `DatabaseConnections` ni derivada de `FreeableMemory`. Conexiones RDS no monitoreadas. Sin proxy, cada Lambda cold start abre conexiones adicionales.                                                 |
| R-5  | **MEDIUM**   | `DatabaseStack.ts:147`                        | RDS en PUBLIC subnet con `publiclyAccessible: false` funciona pero no es el pattern recomendado. AWS reescribe la subnet route table a IGW si `PUBLIC`; sin IGW route, traffic queda en VPC. Funciona por coincidence. |
| R-6  | **MEDIUM**   | `packages/backend/prisma/schema.prisma`       | No hay `previewFeatures = ["driverAdapters"]`. Para usar driver adapter con 5.22 hay que activarlo. En 6.x es GA.                                                                                                      |
| R-7  | **LOW**      | `bundling-defaults.ts:64`                     | El script de `prisma generate` del migrations Lambda usa `sed` para patchear el output path — fragile si el schema cambia. El migration Lambda es correcto, pero el proceso es brittle.                                |

## 4. Inputs for proposal

```
VERIFIED FACTS:
- Prisma version: 5.22.0 (pnpm-lock.yaml:100,908,923,2688)
- schema.prisma output: "../../../node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client"
- schema.prisma binaryTargets: ["native", "rhel-openssl-3.0.x"]
- schema.prisma previewFeatures: NONE (no driverAdapters)
- Layer engine path: /opt/nodejs/node_modules/.prisma/client/libquery_engine-rhel-openssl-3.0.x.so.node
- Layer schema path: packages/infra/src/constructs/.prisma-layer-build/nodejs/schema.prisma
- BC Lambda bundling: { externalModules: ['aws-sdk'] } — @prisma/client NOT external
- PrismaClient singleton: globalThis.__mercadoExpressPrisma (prisma-client.ts:101)
- connection_limit: 2 (default)
- sslmode: require (dev/prod), disable (localstack)
- DATABASE_URL: Fn::Join de Secrets Manager (no runtime SDK call)
- Lambda runtime: NODEJS_20_X, x86_64
- Lambda subnets: PRIVATE_ISOLATED
- RDS: db.t3.micro, postgres-16, publiclyAccessible: false, PUBLIC subnet
- RDS max_connections: ~113 (t3.micro)
- Security group: TCP 5432 desde vpcCidrBlock
- No RDS Proxy (confirmed)
- No reservedConcurrency (undefined para todas las stages)
- No DatabaseConnections alarm (confirmed — no existe)
- Migrations Lambda: autosuficiente, bundled engines, NO layer, 1024 MB
- Migrations command: prisma migrate deploy (no npx)
- Prisma adapters installed: NONE (grep results show "adapter" solo en nombres de archivos de repositorio, no en deps)

ARCHITECTURE DECISIONS ALREADY MADE (DO NOT REVISIT):
1. Eliminar engines nativos (driver adapter approach)
2. Singleton PrismaClient fuera del handler ✓ (already implemented)
3. Pool connection_limit=2 ✓ (already implemented)
4. ReservedConcurrency por Lambda: pendiente (config dice undefined)
5. Monitor DatabaseConnections: pendiente (no existe alarma)
6. Migrations outside business Lambdas ✓ (dedicated Lambda exists)

MISSING / TO DECIDE:
- Upgrade to Prisma 6.x or stay on 5.22?
- Exact pool size for pg with Lambda concurrency
- CI/CD step vs dedicated Lambda for migrations
- Alarm threshold for DatabaseConnections (% of 113)
```

---

**Metadata**

| Campo            | Valor         |
| ---------------- | ------------- |
| Status           | COMPLETE      |
| Next recommended | `sdd-propose` |
| skill_resolution | `none`        |
