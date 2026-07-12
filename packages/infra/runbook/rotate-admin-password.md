# Runbook — Rotate Secrets (MercadoExpress CDK)

This runbook covers rotation of the two operator-managed secrets used by
the MercadoExpress AWS deployment:

1. **Admin bootstrap password** — used by the seed Lambda to bootstrap the
   `admin` user row in `users` (bcrypt cost 10).
2. **JWT signing secret** — HS256 secret used by the auth Lambda and
   verified by every protected Lambda via `ssm:GetParameter`.

Both live in **SSM Parameter Store** as `SecureString` parameters, scoped
per stage:

| Parameter                                     | Used by                  |
| --------------------------------------------- | ------------------------ |
| `/MercadoExpress/{stage}/admin-password`      | Migrations Lambda (seed) |
| `/MercadoExpress/{stage}/jwt-secret`          | Auth + protected Lambdas |
| `/MercadoExpress/{stage}/jwt-secret-previous` | Auth + protected Lambdas |

`{stage}` is one of `dev` | `prod` | `localstack`. Never rotate on
`localstack` — that stage reads from `process.env` directly, not SSM.

---

## Prerequisites

- AWS CLI configured with a profile that has `ssm:PutParameter`,
  `ssm:GetParameter`, `ssm:GetParameters` against the target stage's
  parameters, and `kms:Encrypt` / `kms:Decrypt` on `alias/aws/ssm`
  (default permission for the AWS-managed key).
- The CDK stack for the target stage has been deployed at least once
  (so the SSM parameters exist).

Verify before starting:

```bash
aws ssm get-parameter \
  --name /MercadoExpress/dev/admin-password \
  --with-decryption \
  --query 'Parameter.Value' \
  --output text
```

If you get `ParameterNotFound`, the stage has never been deployed.

---

## 1. Rotate the Admin Bootstrap Password

The admin user lives in the `users` table with a bcrypt-hashed
`passwordHash`. Rotating the password has TWO independent effects:

1. The **DB row** (`users.passwordHash`) — must be updated via the
   `scripts/rotate-admin-password.ts` script.
2. The **SSM parameter** (`/MercadoExpress/{stage}/admin-password`) —
   must be updated via `aws ssm put-parameter`. The Migrations Lambda
   reads this value to (re-)seed the admin row on each stack create /
   update.

**Both must be updated, in this order, before the next deploy**, or the
seed will overwrite the rotated DB hash with the old SSM value.

### Step 1.1 — Rotate the SSM parameter

```bash
# Generate a strong random cleartext (24 bytes → 32 base64url chars).
NEW_ADMIN_PASSWORD=$(openssl rand -base64 24 | tr -d '/+' | tr -d '\n')

aws ssm put-parameter \
  --name /MercadoExpress/<stage>/admin-password \
  --value "$NEW_ADMIN_PASSWORD" \
  --type SecureString \
  --overwrite
```

Replace `<stage>` with `dev` or `prod`. The cleartext is in the shell
history — purge it:

```bash
history -d "$HISTCMD" 2>/dev/null || true
unset NEW_ADMIN_PASSWORD
```

### Step 1.2 — Rotate the DB row

From the repo root:

```bash
ADMIN_USERNAME=admin DATABASE_URL=<prod-conn-string> \
  pnpm --filter backend exec tsx scripts/rotate-admin-password.ts \
  | tee /tmp/admin-rotation.json
```

The script prints JSON with the new cleartext exactly once. Capture it
into your password manager:

```bash
jq -r '.password' /tmp/admin-rotation.json | pbcopy   # macOS
jq -r '.password' /tmp/admin-rotation.json | xclip    # Linux
shred -u /tmp/admin-rotation.json
```

### Step 1.3 — Verify

Open a fresh shell. The auth Lambda should now accept the new password:

```bash
API_URL=$(aws cloudformation describe-stacks \
  --query "Stacks[?Name=='MercadoExpress-<stage>'].Outputs[?OutputKey=='HttpApiUrl'].OutputValue" \
  --output text)

curl -X POST "$API_URL/api/v1/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$NEW_ADMIN_PASSWORD\"}"
```

A `200` with a JWT token confirms the rotation landed. A `401` means the
SSM parameter was updated but the DB row was not, or vice versa — see the
`Pitfalls` section.

---

## 2. Rotate the JWT Signing Secret

JWT signing uses a **dual-secret window** (see `design.md` ADR-3). To
rotate without invalidating in-flight tokens:

| Step | `jwt-secret`              | `jwt-secret-previous` | `JWT_OVERLAP_SECONDS` |
| ---- | ------------------------- | --------------------- | --------------------- |
| T0   | current (about to retire) | empty / unused        | 3600                  |
| T1   | NEW secret                | retired `current`     | 3600                  |
| T2   | NEW secret (now current)  | cleared               | 3600                  |

`T0 → T1` happens in one `put-parameter` call. Tokens signed with
either secret validate during the overlap. After `JWT_OVERLAP_SECONDS`
(default 3600s = 1h), `previous` is cleared.

The Lambda reads `JWT_SECRET` and `JWT_SECRET_PREVIOUS` env vars; both
parameter names are baked into the CFN template, so a code redeploy is
NOT required for rotation.

### Step 2.1 — Generate a new HS256 secret

```bash
NEW_JWT_SECRET=$(openssl rand -base64 48 | tr -d '/+' | tr -d '\n')
```

48 random bytes = 384 bits of entropy — well above the HS256 spec floor
of 256 bits.

### Step 2.2 — Swap current ↔ previous

```bash
# Snapshot the current value (we'll need it for `previous`).
OLD_JWT_SECRET=$(aws ssm get-parameter \
  --name /MercadoExpress/<stage>/jwt-secret \
  --with-decryption \
  --query 'Parameter.Value' \
  --output text)

# Set the new current.
aws ssm put-parameter \
  --name /MercadoExpress/<stage>/jwt-secret \
  --value "$NEW_JWT_SECRET" \
  --type SecureString \
  --overwrite

# Set the old current as the previous (so in-flight tokens still work).
aws ssm put-parameter \
  --name /MercadoExpress/<stage>/jwt-secret-previous \
  --value "$OLD_JWT_SECRET" \
  --type SecureString \
  --overwrite
```

After 1 hour (default `JWT_OVERLAP_SECONDS`), clear `previous` so the
window doesn't grow into a permanent dual-verify path:

```bash
aws ssm delete-parameter \
  --name /MercadoExpress/<stage>/jwt-secret-previous
```

(If `JWT_OVERLAP_SECONDS` was tuned higher, schedule the delete
accordingly.)

### Step 2.3 — Verify

Auth with a token issued BEFORE the rotation (still valid during the
window):

```bash
# Use the OLD token (you have it from before T0).
curl -H "Authorization: Bearer $OLD_TOKEN" \
  "$API_URL/api/v1/products"
# Expect 200 — verifies the previous-secret path is active.
```

Then auth with a freshly issued token (signed with `NEW_JWT_SECRET`):

```bash
curl -X POST "$API_URL/api/v1/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$NEW_ADMIN_PASSWORD\"}"

# Use the returned token for a follow-up call.
curl -H "Authorization: Bearer $NEW_TOKEN" \
  "$API_URL/api/v1/products"
# Expect 200 — verifies the new current-secret path is active.
```

### Emergency rotation (compromised secret)

If a JWT secret is suspected leaked, collapse the window:

```bash
# 1. Generate a new secret.
NEW_JWT_SECRET=$(openssl rand -base64 48 | tr -d '/+' | tr -d '\n')

# 2. Replace current immediately (do NOT preserve the old as previous).
aws ssm put-parameter \
  --name /MercadoExpress/<stage>/jwt-secret \
  --value "$NEW_JWT_SECRET" \
  --type SecureString \
  --overwrite

# 3. Clear previous so old tokens fail fast.
aws ssm delete-parameter \
  --name /MercadoExpress/<stage>/jwt-secret-previous
```

All tokens issued with the old secret are invalidated on the next cold
start of any Lambda (≤ 1 minute in production).

---

## 3. Cross-cutting: rotate before a deploy

If the deployment pipeline includes re-running the Migrations Custom
Resource, the seed Lambda will RE-SEED the admin user with the value
from `/MercadoExpress/{stage}/admin-password`. After step 1 above,
this is a no-op (same value). If you only rotated the DB and forgot
step 1.1, the next deploy will silently revert.

Always do **1.1 → 1.2 → 1.3** in that order. The seed step in
`packages/backend/prisma/seed.ts` keys on `username` and uses upsert,
so repeating the seed with a different `ADMIN_PASSWORD` will overwrite
the bcrypt hash to whatever the SSM parameter currently holds.

---

## 4. Pitfalls and how to detect them

| Symptom                                        | Likely cause                                                                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 401 on freshly issued admin token              | DB rotated but SSM not, then a deploy reseeded                                                                                     |
| 401 on a pre-rotation token after 1h+          | `previous` was cleared too early; reset the overlap                                                                                |
| `ParameterNotFound` on `aws ssm get-parameter` | Stage never deployed, OR using the wrong stage name                                                                                |
| CloudFormation drift on SSM `Description`      | Cosmetic only; CDK does not try to enforce string equality on description                                                          |
| `AccessDenied` on `kms:Encrypt`                | The AWS-managed key is `alias/aws/ssm` and the principal needs the default permissions; do NOT use a custom CMK unless intentional |

---

## 5. Audit and logging

All SSM read/write activity is logged to CloudTrail with the IAM
principal. To see who rotated what:

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=PutParameter \
  --max-items 50 \
  --query 'Events[?contains(RequestParameters,name,`/MercadoExpress/<stage>`)]'
```

For the Lambda-side read path, check the migrations Lambda CloudWatch
log group (`/aws/lambda/MercadoExpress-<stage>-migrations-lambda`) for
`msg: "running prisma seed"` lines; these correspond to a deploy-time
seed invocation.

---

## Related

- `scripts/rotate-admin-password.ts` — DB-side bcrypt rotation helper
- `packages/infra/src/stacks/DatabaseStack.ts` — admin-password SSM construct
- `packages/infra/src/stacks/ApiStack.ts` — JWT + JWT-previous SSM constructs
- `packages/infra/src/constructs/jwt-secret.ts` — dual-secret design rationale
- `packages/backend/prisma/seed.ts` — admin user upsert; reads `ADMIN_PASSWORD` from env
