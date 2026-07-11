# Proposal: add-localstack-dev-env

## Status: superseded by replace-localstack-dev-server on 2026-07-10

## Problem

El backend de MercadoExpress es 100% AWS-native (Lambda + API Gateway v2 + RDS Postgres + CloudFront + Secrets Manager + SSM Parameter Store). Los desarrolladores no pueden correr ni probar nada localmente sin una cuenta AWS real, lo que:

- Bloquea el onboarding de nuevos devs (necesitan credenciales AWS)
- Encarece el ciclo de desarrollo (deploy round-trip vs iteración local)
- Hace e2e testing costoso y lento
- Imposibilita trabajar offline o desde redes restringidas
- Acopla el desarrollo a un vendor único

El frontend Vue 3 sí tiene `pnpm dev:frontend` local, pero sin backend real no se puede probar end-to-end.

## Constraints (locked)

- **C-1**: TODO el ambiente local debe levantarse con **una sola línea de comando**: `docker compose -f docker-compose.dev.yml up -d`. Cero pasos manuales adicionales.
- **C-2**: **Cero valores hardcoded** en código, configs, URLs, puertos, secrets. Todo debe venir de variables de entorno (`env_file: .env.dev`) para que el mismo código funcione tanto en local como en AWS sin cambios.
- **C-3**: Los puertos deben ser **configurables** via env vars para evitar conflictos entre devs (e.g., dev A usa 5432, dev B usa 5433).
- **C-4**: Cuando se despliegue a AWS real (vía GitHub Actions en futuro), las mismas env vars deben mapearse a Secrets Manager / SSM Parameter Store sin modificar el código.
- **C-5**: La arquitectura debe ser **vendor-aware**: el código detecta `STAGE=localstack` y ajusta comportamiento (sslmode, secrets source, etc.) sin branches en lógica de negocio.
- **C-6**: Pensado para **futuro GitHub Actions workflow** que use este mismo compose para CI local e2e antes de deploy a AWS.

## User Stories

- **US-1**: Como developer, quiero correr un solo comando (`docker compose -f docker-compose.dev.yml up -d`) y tener backend + DB + frontend funcionando localmente sin pasos adicionales.
- **US-2**: Como developer, quiero hacer `curl http://localhost:${API_GATEWAY_PORT}/api/v1/products` y obtener respuesta real (no mock).
- **US-3**: Como developer, quiero que las Lambdas deployadas lean del PostgreSQL local via `DATABASE_URL` configurable, no de RDS AWS.
- **US-4**: Como developer, quiero que el frontend Vite apunte automáticamente al API Gateway de LocalStack via `VITE_API_BASE_URL` configurable.
- **US-5**: Como developer, quiero que las migrations de Prisma corran automáticamente al levantar (parity con AWS deploy).
- **US-6**: Como developer, quiero que los secretos (DATABASE_URL, JWT_SECRET) se lean de `.env.dev` sin Secrets Manager cuando `STAGE=localstack`.
- **US-7**: Como developer, quiero poder cambiar puertos en `.env.dev` si tengo colisiones con otros servicios locales.
- **US-8**: Como CI engineer (futuro), quiero que el mismo `docker-compose.dev.yml` funcione en GitHub Actions runners con la misma lógica de auto-deploy.

## Acceptance Criteria

- **AC-1**: `docker compose -f docker-compose.dev.yml up -d` levanta postgres + localstack + deployer + frontend **sin intervención manual**.
- **AC-2**: PostgreSQL accesible en `${POSTGRES_HOST}:${POSTGRES_PORT}` con extensión `vector` (pgvector 0.8.x).
- **AC-3**: LocalStack accesible en `${LOCALSTACK_HOST}:${LOCALSTACK_PORT}` con servicios lambda, apigateway, secretsmanager, ssm, iam, cloudformation, sts.
- **AC-4**: `cdk deploy` se ejecuta automáticamente contra LocalStack al boot del servicio `deployer` (sin pasos manuales).
- **AC-5**: Lambdas deployadas responden a `curl` en endpoints reales usando `${API_GATEWAY_URL}` derivado de la salida del CDK.
- **AC-6**: Frontend Vite accesible en `${FRONTEND_PORT}` y muestra login screen.
- **AC-7**: `VITE_API_BASE_URL` se construye desde `${API_GATEWAY_URL}` dinámico (no hardcoded).
- **AC-8**: Migrations de Prisma corren dentro del Lambda custom resource (parity con AWS deploy).
- **AC-9**: `DATABASE_URL` se lee de env var (no via Secrets Manager) cuando `STAGE=localstack`.
- **AC-10**: `JWT_SECRET` se lee de env var (no via Secrets Manager) cuando `STAGE=localstack`.
- **AC-11**: **Cero URLs hardcoded** en el código. Todo viene de env vars con defaults sensatos.
- **AC-12**: **Cero puertos hardcoded** en el código. Todos configurables via `.env.dev`.
- **AC-13**: Cambiar un puerto en `.env.dev` (e.g., `POSTGRES_PORT=5433`) no requiere tocar el código.
- **AC-14**: El mismo código CDK genera templates válidos para `STAGE=localstack` y `STAGE=dev|prod` sin duplicación.
- **AC-15**: Documentación en `docs/LOCAL-DEV.md` cubre: setup, troubleshooting, qué hacer si un puerto está ocupado, cómo limpiar volúmenes.
- **AC-16**: `.env.dev` tiene **defaults funcionales** pero también es **override-able** (e.g., `.env.dev.local` para overrides personales).
- **AC-17**: El compose se detiene con `docker compose -f docker-compose.dev.yml down` y borra volúmenes con `down -v`.
- **AC-18**: **Cero side effects** al hacer `down`: la DB local se preserva (volumen con nombre) para no perder trabajo entre sesiones.

## Non-goals

- **NO** replicar RDS real (LocalStack Community no soporta `AWS::RDS::DBInstance`).
- **NO** replicar CloudFront (LocalStack Community no soporta `AWS::CloudFront::Distribution`).
- **NO** deployar a AWS real desde local (eso sigue en CI/CD workflows).
- **NO** agregar GitHub Actions workflows **en este change** (queda para `add-ci-localstack-workflow` futuro).
- **NO** migrar a LocalStack Pro (asumimos Community/free).
- **NO** cambiar la arquitectura del backend (las Lambdas reales se deployan, no se mockean).
- **NO** afectar el flujo de deploy a AWS real (`pnpm deploy:dev` sigue funcionando con sus propios secrets).
- **NO** duplicar código entre stages: la lógica de skip/ssl/env-var debe ser **un solo path** parametrizado.

## Risks

- **R-1 (HIGH)**: LocalStack Community tiene limitaciones vs Pro. RDS y CloudFront son silent-fail. Mitigación: skip explícito en CDK + flag claro en logs.
- **R-2 (MEDIUM)**: Cold start de Lambdas en LocalStack es lento (~5-10s) en primera ejecución. Mitigación: healthcheck con timeout generoso + retries.
- **R-3 (MEDIUM)**: Tests e2e (Playwright) deben correr contra LocalStack, no contra backend mockeado. Mitigación: actualizar `playwright.config.ts` para apuntar a `${API_GATEWAY_URL}`.
- **R-4 (LOW)**: Drift entre schema local vs AWS. Mitigación: las migrations son las mismas, corren en ambos lados.
- **R-5 (LOW)**: Volumen `pgdata` puede crecer sin límite. Mitigación: documentar `docker volume rm` en README.
- **R-6 (LOW)**: `.env.dev` puede quedar commiteado con secrets reales. Mitigación: `.env.dev` en `.gitignore`, solo `.env.dev.example` commiteado con defaults.
- **R-7 (MEDIUM)**: Si un dev cambia un puerto y olvida reiniciar, comportamiento inconsistente. Mitigación: el deployer loggea todos los puertos resueltos al arrancar.

## Architectural Decisions (locked por el usuario)

- **AD-1**: Migrations corren dentro del Lambda custom resource (`migrations-lambda.ts`) — parity con AWS deploy.
- **AD-2**: `DATABASE_URL` y `JWT_SECRET` como env vars directos en `.env.dev`, leídos por Lambda runtime cuando `STAGE=localstack`.
- **AD-3**: NO se modifican GitHub Actions workflows en este change (queda para cambio futuro `add-ci-localstack-workflow`).
- **AD-4 (NEW)**: **Toda configuración** (puertos, URLs, secrets) viene de env vars. Defaults en `.env.dev`, overrides en `.env.dev.local` (gitignored).
- **AD-5 (NEW)**: **Single-command onboarding**: `docker compose -f docker-compose.dev.yml up -d` es lo único que el dev corre.
- **AD-6 (NEW)**: **Vendor-aware code**: el código CDK detecta `STAGE` y ajusta comportamiento sin branches duplicados. Misma estructura de archivos para `localstack` y `dev|prod`.
- **AD-7 (NEW)**: **AWS-deploy compatible**: las env vars del `.env.dev` mapean 1:1 a Secrets Manager / SSM cuando se deploya a AWS. El CI futuro solo cambia la fuente de los secrets, no el código.

## Slicing (4 PRs, ninguno > 400 LOC)

### PR 1: Stage flags + env-driven config (readability lens) — ~120 LOC

- Extiende `Stage` union type: `'dev' | 'prod' | 'localstack'`
- Renombra `ApiStack` props: `distributionDomainName` → `corsAllowOrigin` (genérico)
- Introduce helper `infraConfig.ts` que centraliza defaults por stage
- **Cero URLs hardcoded**: cada recurso lee de `${VAR}` con default por stage
- **Test**: `synth:localstack` y `synth:dev` generan templates válidos con misma estructura

### PR 2: Skip RDS/CloudFront + env-var bypass (risk lens) — ~200 LOC

- `app.ts`: branches condicionales para `skipRds` y `skipCloudFront` context flags
- `ApiStack`: cuando `STAGE=localstack`, no leer de Secrets Manager → leer de env var `DATABASE_URL` directo
- `migrations-lambda.ts`: branch cuando `STAGE=localstack` → usa `DATABASE_URL` directo
- `prisma-client.ts`: sslmode=disable cuando `STAGE=localstack`, sslmode=require en AWS
- **Cero cambios en handlers**: la lógica de negocio no sabe el stage
- **Test**: `synth:localstack --context skipRds=true --context skipCloudFront=true` genera solo Api+Observability

### PR 3: docker-compose + postgres-init + deployer (resilience lens) — ~350 LOC

- `docker-compose.dev.yml`: postgres + localstack + deployer + frontend
- `docker/postgres-init/01-pgvector.sql`: `CREATE EXTENSION vector + pgcrypto`
- `docker/deployer/Dockerfile`: Node 20 + pnpm + cdk
- `docker/deployer/entrypoint.sh`:
  - Lee `.env.dev` y exporta todas las vars
  - Espera LocalStack healthy (polling con retry)
  - Corre `cdk deploy` con `--context stage=localstack`
  - Captura `ApiUrl` del output y lo escribe a un archivo `.api-url` que el frontend lee
- `.env.dev.example`: defaults funcionales (commited)
- `.env.dev`: gitignored (el dev copia `.env.dev.example` a `.env.dev`)
- `.gitignore`: añade `.env.dev`, `.env.dev.local`, `.api-url`
- **Test**: `docker compose up` → `curl http://localhost:${LOCALSTACK_PORT}/_localstack/health` OK → deployer termina → archivo `.api-url` existe con URL

### PR 4: Frontend container + Vite config (readability lens) — ~150 LOC

- `docker/frontend/Dockerfile`: Vite dev server con `host=0.0.0.0` y `strictPort=false`
- Servicio `frontend` en `docker-compose.dev.yml` que lee `.api-url` y exporta como `VITE_API_BASE_URL`
- `packages/frontend/vite.config.ts`: usa `process.env.VITE_API_BASE_URL` con fallback al `.api-url`
- `docs/LOCAL-DEV.md`: quickstart + troubleshooting + sección "Ports" + sección "Clean reset"
- Actualización README raíz con sección "Local development"
- **Test**: `curl http://localhost:${FRONTEND_PORT}` → HTML de Vite con `<title>MercadoExpress</title>`

## Environment Variables Reference

Todas las vars tienen default funcional. El dev solo override si hay conflicto.

| Var                     | Default                                                                                               | Propósito                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `POSTGRES_USER`         | `ceiba`                                                                                               | Usuario DB                                |
| `POSTGRES_PASSWORD`     | `ceiba_dev`                                                                                           | Password DB (solo local)                  |
| `POSTGRES_DB`           | `mercadoexpress`                                                                                      | Nombre DB                                 |
| `POSTGRES_HOST`         | `postgres` (en compose) / `localhost` (en host)                                                       | Host DB                                   |
| `POSTGRES_PORT`         | `5432`                                                                                                | Puerto DB                                 |
| `DATABASE_URL`          | `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}` | URL Prisma                                |
| `LOCALSTACK_HOST`       | `localstack` (en compose) / `localhost` (en host)                                                     | Host LocalStack                           |
| `LOCALSTACK_PORT`       | `4566`                                                                                                | Puerto LocalStack                         |
| `AWS_ENDPOINT_URL`      | `http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT}`                                                        | Endpoint AWS CLI/CDK                      |
| `AWS_ACCESS_KEY_ID`     | `test`                                                                                                | Dummy key para LocalStack                 |
| `AWS_SECRET_ACCESS_KEY` | `test`                                                                                                | Dummy secret para LocalStack              |
| `AWS_DEFAULT_REGION`    | `us-east-1`                                                                                           | Región                                    |
| `STAGE`                 | `localstack`                                                                                          | Stage del deploy                          |
| `JWT_SECRET`            | `dev-secret-change-me-in-prod-32chars-min`                                                            | Secret JWT (solo local)                   |
| `FRONTEND_PORT`         | `5173`                                                                                                | Puerto Vite dev server                    |
| `API_GATEWAY_PORT`      | `4566`                                                                                                | Puerto API Gateway (mismo que LocalStack) |

## Open Questions

- **Q-1**: ¿Cómo se ejecutan las migrations exactamente en el entrypoint? (current plan: via custom resource Lambda después del cdk deploy)
- **Q-2**: ¿Qué pasa si la primera ejecución de cdk deploy tarda más que el healthcheck de LocalStack? (current plan: entrypoint hace polling con timeout 5min)
- **Q-3**: ¿Los secrets en LocalStack Secrets Manager se crean desde el entrypoint o se leen directo de env? (current plan: env vars directos por AD-2)
- **Q-4**: ¿Cómo se manejan los CORS entre Vite dev server y LocalStack API Gateway? (current plan: LocalStack APIGW permite `*` por defecto)
- **Q-5**: ¿Qué pasa con las migraciones idempotentes si el volumen pgdata tiene datos? (current plan: Prisma migrations son idempotentes por diseño)
- **Q-6 (NEW)**: ¿Cómo se mapean las env vars a Secrets Manager en AWS deploy? (current plan: CI futuro usa `aws secretsmanager create-secret --secret-string file://.env.prod`)
- **Q-7 (NEW)**: ¿`.env.dev` se commitea o no? (current plan: NO, solo `.env.dev.example`. El dev copia con `cp .env.dev.example .env.dev`)

## Dependencies

- Docker 24+ con Docker Compose v2
- Node 20 (en imagen del deployer)
- pnpm 9 (en imagen del deployer)
- PostgreSQL 16 client (no requerido en host, todo corre en containers)

## Estimated Effort

- ~820 LOC total (10 archivos modificados + 7 nuevos)
- 4 PRs secuenciales (cada uno mergeable independientemente)
- ~2 horas de setup + ~1 hora de troubleshooting típico por dev nuevo
- ~30 min para limpiar y reset si algo se rompe

## AWS Deploy Compatibility (futuro)

Cuando se implemente el workflow de GitHub Actions:

```yaml
# .github/workflows/deploy-dev.yml (futuro)
- name: Load secrets
  run: |
    echo "DATABASE_URL=$(aws secretsmanager get-secret-value --secret-id ceiba/dev/db --query SecretString --output text)" >> $GITHUB_ENV
    echo "JWT_SECRET=$(aws secretsmanager get-secret-value --secret-id ceiba/dev/jwt --query SecretString --output text)" >> $GITHUB_ENV
- name: CDK deploy
  run: pnpm -C packages/infra exec cdk deploy --context stage=dev --require-approval never
- name: Run e2e
  run: docker compose -f docker-compose.dev.yml up e2e-runner
```

El mismo código CDK maneja ambos stages porque toda config viene de env vars.

## References

- Explore artifact: topic_key `sdd/add-localstack-dev-env/explore`, observation id 303
- LocalStack coverage: <https://docs.localstack.cloud/references/coverage/>
- pgvector image: <https://hub.docker.com/r/pgvector/pgvector>
- 12-Factor App config: <https://12factor.net/config>
