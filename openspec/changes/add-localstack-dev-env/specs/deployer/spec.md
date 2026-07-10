# Spec: CDK Auto-deploy Service

## Purpose

Provide a Docker service that waits for LocalStack readiness, runs `cdk deploy` against the local endpoint, captures the API URL produced by the stack, and writes it to a file the frontend reads — so the developer does not run any CDK command by hand.

## Requirements

### Requirement: Wait for LocalStack readiness

The deployer service MUST block any CDK invocation until LocalStack's health endpoint reports all required services as available.

**As a** developer who just ran `docker compose up`
**I want** the deployer to wait for LocalStack automatically
**So that** I don't see "endpoint not found" errors on first boot

#### Scenario: Deployer blocks on unhealthy LocalStack

- GIVEN the deployer container starts before LocalStack is ready
- WHEN the entrypoint begins
- THEN it MUST poll `http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT}/_localstack/health` at a configurable interval
- AND MUST NOT invoke `cdk deploy` until the response status is 200 AND lists the required services as available

#### Scenario: Deployer proceeds on healthy LocalStack

- GIVEN LocalStack reports all required services as available
- WHEN the deployer detects readiness
- THEN it MUST stop polling and proceed to the deploy step within one polling interval

### Requirement: Run cdk deploy against LocalStack

The deployer service MUST invoke `cdk deploy` with `stage=localstack` and the local endpoint URL so the CDK app produces a stack LocalStack can host.

**As a** CDK application
**I want** the deployer to invoke the correct synth+deploy commands
**So that** the stack lands on LocalStack without manual intervention

#### Scenario: Deploy command is non-interactive

- GIVEN the deployer is ready to invoke CDK
- WHEN it runs the deploy command
- THEN the command MUST pass `--require-approval never` (or equivalent) so it never blocks on a manual prompt
- AND the command MUST pass `--context stage=localstack` so the CDK app applies the localstack configuration branch

#### Scenario: AWS endpoint is overridden to LocalStack

- GIVEN the deployer sets `AWS_ENDPOINT_URL=http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT}` in its environment
- WHEN the CDK app makes AWS API calls
- THEN those calls target LocalStack, not the real AWS account

### Requirement: Capture the API URL output

The deployer service MUST extract the API Gateway URL from the CDK stack outputs so the frontend can be configured to point at it.

**As a** frontend container
**I want** to know where the API Gateway is reachable
**So that** my HTTP calls go to the right place

#### Scenario: API URL is read from CDK output

- GIVEN `cdk deploy` has finished successfully
- WHEN the deployer reads stack outputs
- THEN it MUST extract the value of the `ApiUrl` (or equivalent named) output
- AND the extracted value MUST be a complete URL including scheme, host, port, and stage prefix

#### Scenario: Missing API URL is a hard failure

- GIVEN `cdk deploy` succeeded but the expected output is not present
- WHEN the deployer checks for the API URL
- THEN it MUST log a clear error indicating which output key was missing
- AND it MUST exit non-zero so the container restart policy surfaces the problem

### Requirement: Write the API URL to a shared file

The deployer service MUST persist the captured API URL to a file mounted into both the deployer and the frontend service so the frontend can read it after Vite starts.

**As a** frontend container
**I want** to read the API URL from a known file path
**So that** I don't depend on the deployer's stdout or environment

#### Scenario: File is written once deploy succeeds

- GIVEN the API URL has been captured
- WHEN the deployer writes the file
- THEN the file MUST exist at the shared mount path
- AND its contents MUST be exactly the API URL on a single line with no trailing whitespace

#### Scenario: Frontend reads the file at boot

- GIVEN the file exists at the shared mount path
- WHEN the frontend container starts
- THEN the frontend's startup script MUST read the file and export its contents as `VITE_API_BASE_URL`
- AND Vite MUST expose that value to the client-side code

### Requirement: Idempotent retries

The deployer service MUST tolerate a transient first-boot failure (e.g., LocalStack started slowly, CDK deploy raced with container readiness) by retrying with backoff rather than exiting permanently.

**As a** developer
**I want** the deployer to retry on transient failures
**So that** I don't have to manually rerun anything after the first slow boot

#### Scenario: LocalStack readiness timeout triggers retry

- GIVEN the deployer polls LocalStack and the readiness timeout elapses before LocalStack becomes healthy
- WHEN the deployer times out
- THEN it MUST log the timeout, sleep for a configurable backoff interval, and resume polling
- AND it MUST NOT exit non-zero during the retry window

#### Scenario: CDK deploy failure triggers container restart

- GIVEN `cdk deploy` exits non-zero due to a transient error
- WHEN the entrypoint detects the failure
- THEN the container MUST exit non-zero so Docker's restart policy restarts it
- AND on restart, the deployer MUST re-read the env vars and re-run the full sequence

### Requirement: Log all resolved configuration at startup

The deployer service MUST log every resolved environment variable and stage-relevant setting at startup so a developer can immediately see which values were applied (and catch an override that did not take effect).

**As a** developer debugging a misbehaving stack
**I want** to see the resolved config in the logs
**So that** I can confirm my `.env.dev` overrides actually applied

#### Scenario: All env vars are logged on entry

- GIVEN the deployer container starts
- WHEN the entrypoint exports the variables from `.env.dev`
- THEN it MUST print each variable name and resolved value to stdout (with secret values masked)
- AND the log line MUST precede any CDK invocation

#### Scenario: Stage and endpoint are highlighted

- GIVEN the deployer is about to invoke CDK
- WHEN it logs the deploy command
- THEN the log line MUST include the active `STAGE` value and the `AWS_ENDPOINT_URL` it will use
- AND the log MUST clearly mark which stage-specific branches are active (skip RDS, skip CloudFront, plain DATABASE_URL)
