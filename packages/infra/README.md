# Infra — AWS CDK Infrastructure

## Stack

- **IaC:** AWS CDK 2 (TypeScript)
- **Regions:** us-east-1 (single region)
- **Stages:** dev, prod

## Layout

```
src/
├── app.ts              # CDK app entry point
├── config.ts          # Stage-aware configuration
└── stacks/
    ├── DatabaseStack.ts       # VPC, RDS PostgreSQL 16 + pgvector
    ├── FrontendStack.ts       # S3 + CloudFront + OAC
    ├── ApiStack.ts           # API Gateway HTTP API + 5 Lambdas
    └── ObservabilityStack.ts  # SNS topics, CloudWatch alarms

constructs/
├── migrations.ts      # CustomResource: runs prisma migrate deploy + seed
└── seed.ts           # Database seeding
```

## Key Resources

### Database

- **Engine:** PostgreSQL 16
- **Extension:** pgvector (for future AI features)
- **Instance:** db.t3.micro (dev), db.t4g.medium (prod)
- **Deletion Protection:** false (dev), true (prod)

### API Gateway

- **Type:** HTTP API v2
- **CORS:** Explicit preflight with CloudFront origin only
- **Allowed Headers:** Content-Type, Authorization, X-Request-Id, Idempotency-Key

### Lambda Functions

| Function         | Purpose                    | Reserved Concurrency       |
| ---------------- | -------------------------- | -------------------------- |
| auth-lambda      | Login + JWT                | 1 (dev) / unlimited (prod) |
| products-lambda  | Products CRUD + categories | 1 (dev)                    |
| inventory-lambda | Stock movements            | 1 (dev)                    |
| alerts-lambda    | Alert listing              | 1 (dev)                    |
| orders-lambda    | Order lifecycle            | 1 (dev)                    |

## Scripts

```bash
pnpm --filter infra build             # TypeScript build
pnpm --filter infra synth             # cdk synth --all
pnpm --filter infra deploy:dev        # cdk deploy MercadoExpress-dev
pnpm --filter infra destroy:dev       # cdk destroy MercadoExpress-dev
```

## Deployment

### CI/CD

GitHub Actions workflows in `.github/workflows/`:

- `ci.yml` — PR checks (test, type-check, lint, synth)
- `deploy-dev.yml` — Deploy to dev on push to main
- `deploy-prod.yml` — Scaffolded (if: false guard)

### OIDC

Production deployments use AWS OIDC role assumption:

```yaml
- uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: ${{ secrets.OIDC_ROLE_ARN }}
```

## Secrets Management

All secrets stored in SSM Parameter Store:

| Parameter                                     | Type         | Description                                        |
| --------------------------------------------- | ------------ | -------------------------------------------------- |
| `/MercadoExpress/{stage}/jwt-secret`          | SecureString | Current JWT signing secret                         |
| `/MercadoExpress/{stage}/jwt-secret-previous` | SecureString | Previous JWT secret (rotation)                     |
| `/MercadoExpress/{stage}/admin-password`      | SecureString | Admin user password                                |
| `/MercadoExpress/{stage}/database-url`        | SecureString | Full database connection URL (Secrets Manager ARN) |

## Observability

### CloudWatch Logs

- 7-day retention on all Lambda log groups
- Structured JSON logging with pino

### Alarms

Three alarms per Lambda:

1. Error rate > 1%
2. Duration > 3 seconds
3. Throttles > 0

### SNS

- One SNS topic per stage
- Email subscription for alarm notifications

## CDK Context

```bash
cdk deploy -c stage=dev  # Deploy to dev
cdk deploy -c stage=prod # Deploy to prod
```
