# Spec: Stage-aware Infrastructure Configuration

## Purpose

Make the CDK infrastructure code aware of the active stage (`localstack`, `dev`, `prod`) so that the same source files produce a correct, deployable stack against LocalStack and against real AWS, without duplicating business logic or hardcoding AWS-specific resources where the local emulator cannot reproduce them.

## Requirements

### Requirement: Stage union type includes localstack

The system MUST recognize three valid stages — `dev`, `prod`, and `localstack` — in its type definitions and configuration tables so that downstream code can switch behavior without stringly-typed branches.

**As a** CDK author
**I want** the `Stage` union to list every supported stage explicitly
**So that** adding a new stage is a type-checked change

#### Scenario: TypeScript accepts all three stages

- GIVEN the `Stage` union is defined
- WHEN the developer runs `pnpm -C packages/infra exec tsc --noEmit`
- THEN the type checker accepts `'dev' | 'prod' | 'localstack'` as valid values
- AND any value outside that union causes a compile error

#### Scenario: Stage tables cover all three stages

- GIVEN the project defines per-stage tables (`Record<Stage, T>`) for tags, deletion protection, reserved concurrency, and alarm recipients
- WHEN a developer adds `'localstack'` to the union
- THEN each table MUST provide an entry for `'localstack'` or the compiler reports the missing key

### Requirement: Skip RDS and CloudFront when stage is localstack

The system MUST skip provisioning of RDS / VPC and CloudFront / S3 when `STAGE=localstack` because LocalStack Community does not support those resource types.

**As a** CDK author
**I want** the stack instantiation to honor a stage flag
**So that** `cdk deploy` against LocalStack does not fail on unsupported resources

#### Scenario: Localstack synth produces no RDS or CloudFront resources

- GIVEN `STAGE=localstack` is passed to the CDK app
- WHEN the developer runs `cdk synth --context stage=localstack`
- THEN the synthesized CloudFormation template contains NO `AWS::RDS::DBInstance`, `AWS::EC2::VPC`, or `AWS::CloudFront::Distribution` resources

#### Scenario: Dev and prod synth produce RDS and CloudFront

- GIVEN `STAGE=dev` is passed to the CDK app
- WHEN the developer runs `cdk synth --context stage=dev`
- THEN the synthesized template includes the RDS instance and the CloudFront distribution as before
- AND the dev/prod behavior is unchanged from the pre-change baseline

### Requirement: DATABASE_URL bypass when stage is localstack

The system MUST allow the Lambdas to receive `DATABASE_URL` as a plain string env var when `STAGE=localstack`, bypassing the Secrets Manager lookup, because no RDS secret exists in the local stack.

**As a** Lambda author
**I want** `DATABASE_URL` to be available directly when running locally
**So that** my handler code can stay identical across stages

#### Scenario: Localstack deployment injects the plain DATABASE_URL

- GIVEN `STAGE=localstack` and `DATABASE_URL` is set in the deployer environment
- WHEN the CDK app deploys
- THEN each Lambda's environment variables MUST contain a literal `DATABASE_URL` string (not a Secrets Manager ARN)
- AND the Lambda handler MUST be able to read it from `process.env.DATABASE_URL` without any extra lookup

#### Scenario: Dev and prod still use Secrets Manager indirection

- GIVEN `STAGE=dev` is active
- WHEN the CDK app deploys
- THEN each Lambda receives a Secrets Manager ARN for the database secret (existing behavior preserved)
- AND the runtime continues to call `GetSecretValue` to resolve the connection string

### Requirement: Prisma SSL mode is stage-aware

The system MUST set `sslmode=disable` for Prisma connections when `STAGE=localstack` and `sslmode=require` for `STAGE=dev|prod`, because the local Postgres container does not have TLS configured.

**As a** backend operator
**I want** Prisma to connect without TLS errors in localstack
**So that** Lambdas can reach the local Postgres container

#### Scenario: Localstack connection string omits TLS

- GIVEN the backend boots with `STAGE=localstack` and `DATABASE_URL=postgresql://user:pass@postgres:5432/db`
- WHEN the Prisma client constructs its connection URL
- THEN the final URL contains `sslmode=disable`

#### Scenario: AWS connection string requires TLS

- GIVEN the backend boots with `STAGE=dev`
- WHEN the Prisma client constructs its connection URL
- THEN the final URL contains `sslmode=require`

### Requirement: CORS allow-origin is stage-aware

The system MUST configure the API Gateway CORS `allow-origin` to match the stage-appropriate frontend origin so the browser can call the API without CORS rejections: the Vite dev server origin in `localstack`, the CloudFront domain in `dev|prod`.

**As a** frontend developer
**I want** CORS preflight to succeed
**So that** my requests don't fail in the browser console

#### Scenario: Localstack CORS allows the Vite origin

- GIVEN `STAGE=localstack`
- WHEN the API Gateway is synthesized
- THEN the CORS configuration allows requests from the Vite dev server origin (the value derived from `FRONTEND_PORT`)

#### Scenario: Dev and prod CORS allow the CloudFront domain

- GIVEN `STAGE=dev`
- WHEN the API Gateway is synthesized
- THEN the CORS configuration allows requests from the deployed CloudFront distribution domain (existing behavior preserved)

## AWS Deploy Parity

- Every env var defined in `.env.dev.example` MUST map 1:1 to a key in AWS Secrets Manager or SSM Parameter Store when the same stack is deployed to AWS.
- The CDK source code MUST be identical for all three stages; only the source of the secrets and the presence of RDS / CloudFront resources change between stages.
- The CI workflow (future change) MUST be able to take the same env-var keys and source them from Secrets Manager without modifying the application code, the CDK code, or the compose file.
