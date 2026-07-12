# OIDC Bootstrap — GitHub Actions → AWS (runbook)

## When you need this

Only required if you want CI (`.github/workflows/deploy-dev.yml`) to deploy automatically on push to `main`. The first manual deploy via `cdk deploy` from your local machine uses `~/.aws/credentials` directly and does NOT need this.

## Prerequisites

- AWS account with admin access (the credentials in `~/.aws/credentials` are fine for the one-time setup).
- `aws-cli` v2 installed and authenticated.

## Steps (run once)

### 1. Create the OIDC provider in IAM

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 74bffa5b4ce5f6b9c0116bf69e2a92e9aae4a5ea
```

> **Nota:** Si falla con `thumbprint mismatch`, ejecutá
> `aws iam get-open-id-connect-provider --arn <ARN>`
> para ver el thumbprint actual esperado por AWS, y actualizá este runbook.

### 2. Create the IAM role with trust policy

Save this as `trust-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:lodeharri/ceiba_software:*"
        }
      }
    }
  ]
}
```

Then:

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
# Edit trust-policy.json replacing <ACCOUNT_ID> with $ACCOUNT_ID
aws iam create-role \
  --role-name MercadoExpress-deploy-dev \
  --assume-role-policy-document file://trust-policy.json
```

### 3. Attach a deploy policy

For dev, AdministratorAccess is acceptable. Tighten before prod.

```bash
aws iam attach-role-policy \
  --role-name MercadoExpress-deploy-dev \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
```

### 4. Save the role ARN in GitHub

- Go to repo Settings → Secrets and variables → Actions.
- New repository secret: name `OIDC_ROLE_ARN`, value = role ARN from step 2 output.

### 5. Verify

The next `git push` to `main` should trigger `.github/workflows/deploy-dev.yml` which calls `aws sts get-caller-identity` and then `cdk deploy`.

## Cleanup

If you want to tear down: `aws iam detach-role-policy ... && aws iam delete-role MercadoExpress-deploy-dev && aws iam delete-open-id-connect-provider ...`
