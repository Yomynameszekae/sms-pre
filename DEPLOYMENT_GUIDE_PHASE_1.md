# Deployment Guide — Ghana School Management System Backend (Phase 1)

**Package:** `ghana-sms-backend` v0.1.0  
**API prefix:** `/api/v1`  
**Applies to:** Phase 1 backend only. No frontend, no Phase 2 modules.

---

## Table of Contents

1. [Deployment Assumptions](#1-deployment-assumptions)
2. [Required Infrastructure](#2-required-infrastructure)
3. [Required Files](#3-required-files)
4. [Environment Setup](#4-environment-setup)
5. [Database Setup](#5-database-setup)
6. [Migration Order](#6-migration-order)
7. [Raw SQL Migration Application](#7-raw-sql-migration-application)
8. [Seed Execution](#8-seed-execution)
9. [Build](#9-build)
10. [Start](#10-start)
11. [Process Manager](#11-process-manager)
12. [Health and Smoke Checks](#12-health-and-smoke-checks)
13. [Auth Smoke Test](#13-auth-smoke-test)
14. [Postman Testing Instructions](#14-postman-testing-instructions)
15. [Rollback Considerations](#15-rollback-considerations)
16. [Common Deployment Issues and Fixes](#16-common-deployment-issues-and-fixes)
17. [Security Checklist](#17-security-checklist)
18. [Final Go-Live Checklist](#18-final-go-live-checklist)

---

## 1. Deployment Assumptions

- You are deploying the **Phase 1 backend only**. There is no frontend. The API is consumed by Postman during stakeholder testing.
- The target environment has outbound network access to PostgreSQL.
- HTTPS is terminated upstream at a reverse proxy (nginx, Caddy, AWS ALB, etc.). The Node.js process listens on plain HTTP internally.
- You have shell access to the deployment host or a CI/CD pipeline that can run `npm` and `psql` commands.
- `psql` (the PostgreSQL CLI client) is installed on the machine running the deployment scripts. It is used only during migration — not at runtime.
- The `.env` file is **never committed to source control**. Secrets are injected via the environment or a secrets manager.
- The seed script is safe to re-run. It is idempotent — it will not create duplicate records or duplicate audit log entries.

---

## 2. Required Infrastructure

### Node.js

| Requirement | Value |
|-------------|-------|
| Minimum version | Node.js 20 LTS |
| Recommended | Node.js 20.x or 22.x LTS |
| Package manager | npm 9+ (bundled with Node.js 20) |

The application was developed and tested on Node.js 25.9.0. It will run on any Node.js ≥ 20 LTS. Do not use odd-numbered (non-LTS) Node.js releases in production.

### PostgreSQL

| Requirement | Value |
|-------------|-------|
| Minimum version | PostgreSQL 14 |
| Recommended | PostgreSQL 15 or 16 |
| Extensions required | `pgcrypto` (applied automatically by the raw SQL migration) |
| Encoding | UTF-8 |
| Timezone | UTC recommended |

The application was developed against PostgreSQL 18.3. All SQL used is compatible with PostgreSQL 14+.

### HTTPS / Reverse Proxy

The Node.js server does **not** terminate TLS. You must place it behind a reverse proxy that handles HTTPS and forwards plain HTTP to the application port (default: 3000).

HTTPS is required in production for the following reasons:

- The refresh token is sent as an HTTP-only cookie. `COOKIE_SECURE=true` requires HTTPS or the browser (and Postman's cookie jar) will not store the cookie.
- Helmet security headers are most effective over HTTPS.

Supported options: **nginx**, **Caddy**, **AWS Application Load Balancer**, **Google Cloud Load Balancer**, **Cloudflare Tunnel**.

The `CORS_ORIGIN` environment variable must be set to the exact origin of any client that will send requests (including Postman's web interface, if used). For desktop Postman, CORS is not enforced by the browser, but it must be set to something valid. Set it to the frontend URL when the frontend is available.

### Environment Variables — Required at Runtime

The application validates environment variables at startup and **will not start** if any required variable is missing or invalid. The following are required:

| Variable | Description | Production value guidance |
|----------|-------------|--------------------------|
| `DATABASE_URL` | Full PostgreSQL connection string | `postgresql://user:pass@host:5432/dbname` |
| `JWT_ACCESS_SECRET` | HMAC secret for signing access tokens | 32+ random characters, unique |
| `JWT_ACCESS_EXPIRES_IN` | Access token lifetime | `15m` recommended |
| `REFRESH_TOKEN_EXPIRES_IN_DAYS` | Refresh token lifetime in days | `7` to `30` |
| `TOKEN_HASH_SECRET` | HMAC secret for hashing refresh/reset tokens | 32+ random characters, **different from JWT_ACCESS_SECRET** |
| `COOKIE_NAME` | Name of the refresh token cookie | Any valid cookie name, e.g. `sms_refresh` |
| `COOKIE_SECURE` | Whether cookie requires HTTPS | `true` in production |
| `COOKIE_SAME_SITE` | Cookie SameSite policy | `strict` or `lax` in production |
| `PASSWORD_HASH_ALGORITHM` | Hash algorithm for passwords | `argon2` |
| `S3_BUCKET` | Storage bucket name (metadata only in Phase 1) | Your bucket name |
| `S3_REGION` | Storage region | Your region |

The following are optional but recommended:

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Application environment | `development` |
| `PORT` | Port the server listens on | `3000` |
| `API_PREFIX` | URL prefix for all routes | `api/v1` |
| `CORS_ORIGIN` | Allowed CORS origin | `http://localhost:3001` |
| `COOKIE_DOMAIN` | Cookie domain scope | not set |
| `ARGON2_MEMORY_COST` | Argon2 memory cost (KB) | `19456` |
| `ARGON2_TIME_COST` | Argon2 iteration count | `2` |
| `ARGON2_PARALLELISM` | Argon2 parallelism | `1` |
| `SEED_SCHOOL_NAME` | School name used by seed script | `Demo Ghana Private School` |
| `SEED_SCHOOL_SLUG` | URL-safe school identifier | `demo-ghana-private-school` |
| `SEED_SUPER_ADMIN_EMAIL` | Seed admin email | `admin@example.com` |
| `SEED_SUPER_ADMIN_PHONE` | Seed admin phone | `233200000000` |
| `SEED_SUPER_ADMIN_PASSWORD` | Seed admin initial password | `ChangeMe123!` |

See `starter-docs/env.example` for the complete annotated template.

---

## 3. Required Files

All of the following must be present in the deployment directory. They are all part of the repository.

| File / Directory | Purpose |
|-----------------|---------|
| `prisma/schema.prisma` | Prisma schema defining all database models |
| `prisma/migrations/` | Prisma migration history — must not be modified manually |
| `starter-docs/phase_1_required_raw_sql_migrations.sql` | Raw SQL for partial indexes, CHECK constraints, and audit triggers |
| `prisma/seed.ts` | Seed script — permissions, roles, school, and Super Admin |
| `scripts/apply-raw-migration.js` | Node.js wrapper that loads `.env` and runs `psql` against the raw SQL file |
| `postman/brite-sms.postman_collection.json` | Postman collection for all 79 Phase 1 endpoints |
| `postman/brite-sms.local.postman_environment.json` | Postman environment for local/staging testing |
| `src/` | All TypeScript source files |
| `package.json` / `package-lock.json` | Dependency manifest |
| `tsconfig.json` | TypeScript configuration |
| `.env` | **Not in repo.** Must be created on the target host. See Section 4. |

---

## 4. Environment Setup

### Step 1 — Create the `.env` file

Copy the example template and fill in all values:

```bash
cp starter-docs/env.example .env
```

Edit `.env` and set at minimum:

```env
NODE_ENV=production

DATABASE_URL=postgresql://user:password@host:5432/your_database

JWT_ACCESS_SECRET=<generate-a-long-random-string>
JWT_ACCESS_EXPIRES_IN=15m

REFRESH_TOKEN_EXPIRES_IN_DAYS=7

TOKEN_HASH_SECRET=<generate-a-different-long-random-string>

COOKIE_NAME=sms_refresh
COOKIE_SECURE=true
COOKIE_SAME_SITE=strict

PASSWORD_HASH_ALGORITHM=argon2

S3_BUCKET=your-bucket-name
S3_REGION=your-region

CORS_ORIGIN=https://your-frontend-domain.com
PORT=3000
```

### Step 2 — Generate secrets

Generate cryptographically random strings for `JWT_ACCESS_SECRET` and `TOKEN_HASH_SECRET`:

```bash
# On Linux/macOS
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# Run twice — use one value for JWT_ACCESS_SECRET, a different value for TOKEN_HASH_SECRET
```

These two secrets **must be different**. Do not reuse them. Do not commit them to source control.

### Step 3 — Verify environment loads correctly

After starting the application (see Section 10), if any required variable is missing or invalid, the process will exit immediately with a clear error message:

```
Environment validation failed: DATABASE_URL must be a string; COOKIE_SECURE must be one of true, false
```

Fix the `.env` file and restart.

---

## 5. Database Setup

### Create the database

The application does not create the database automatically. Create it manually before running migrations:

```bash
# Using psql
psql -U postgres -c "CREATE DATABASE your_database_name;"

# Or using createdb
createdb -U postgres your_database_name
```

The database user specified in `DATABASE_URL` needs the following privileges:

- `CONNECT` on the database
- `CREATE` on the public schema (required by Prisma migrations)
- `USAGE` and `CREATE` on the `public` schema
- Superuser or `CREATEEXTENSION` privilege is required only once — for the `pgcrypto` extension installed by the raw SQL migration. If the database user is not a superuser, have a DBA run `CREATE EXTENSION IF NOT EXISTS "pgcrypto";` on the database first, then the raw SQL migration can be run by a regular user.

### Verify connectivity

```bash
psql "$DATABASE_URL" -c "SELECT current_database(), current_user, version();"
```

This should print the database name, connecting user, and PostgreSQL version. If it hangs or errors, fix the connection string before proceeding.

---

## 6. Migration Order

**This order is mandatory.** Each step depends on the previous one.

```
1. npm ci                      Install dependencies
2. npm run prisma:migrate      Apply Prisma migration (creates all tables and base schema)
3. npm run db:raw-sql           Apply raw SQL (partial indexes, CHECK constraints, audit trigger)
4. npm run prisma:generate     Regenerate Prisma client from the migrated schema
5. npm run prisma:seed         Seed permissions, roles, school, and Super Admin
6. npm run build               Compile TypeScript to dist/
7. npm run start               Start the server
```

Do not skip step 3. The raw SQL migration applies constraints and the audit immutability trigger that are not expressible in Prisma's migration format. The application will run without it, but the database safety guarantees will be absent.

Do not run step 4 before step 2. The Prisma client must be generated against the migrated database schema.

---

## 7. Raw SQL Migration Application

The raw SQL migration file is:

```
starter-docs/phase_1_required_raw_sql_migrations.sql
```

It is applied via a Node.js wrapper script that loads `.env` automatically:

```bash
npm run db:raw-sql
```

The script (`scripts/apply-raw-migration.js`) does the following:

1. Loads `.env` via dotenv (if the file exists).
2. Reads `DATABASE_URL` from the environment.
3. Invokes `psql "$DATABASE_URL" -f starter-docs/phase_1_required_raw_sql_migrations.sql`.
4. Exits with code 1 and a clear error message if `DATABASE_URL` is not set or the SQL file is not found.

**Requirements:** `psql` must be installed on the machine running this script. It does not need to be on the production server — it can be run from a CI/CD runner, a build machine, or a developer workstation with database access.

**What the raw SQL installs:**

| Object | Type | Purpose |
|--------|------|---------|
| `pgcrypto` | Extension | UUID generation support |
| `uq_users_school_email_lower` | Partial unique index | Case-insensitive unique email per school |
| `uq_users_school_phone` | Unique index | Unique phone per school |
| `uq_users_school_linked_entity` | Unique index | One user account per staff/guardian entity |
| `uq_staff_school_email_lower` | Partial unique index | Case-insensitive unique staff email per school |
| `uq_system_role_code` | Partial unique index | Unique role codes at system scope |
| `uq_school_role_code` | Partial unique index | Unique role codes within a school |
| `uq_admission_school_number` | Partial unique index | Unique admission numbers per school |
| `uq_one_active_academic_year_per_school` | Partial unique index | At most one active academic year per school |
| `uq_one_active_term_per_school` | Partial unique index | At most one active term per school |
| `uq_one_primary_guardian_per_student` | Partial unique index | At most one primary guardian per student |
| `uq_one_active_enrollment_per_student_year` | Partial unique index | One active enrollment per student per academic year |
| CHECK constraints | Column constraints | Date ranges, positive capacity, enum guards on terms/classrooms |
| `prevent_audit_log_changes()` | Trigger function | Raises exception on any UPDATE or DELETE on `audit_logs` |
| `trg_prevent_audit_log_update` | Trigger | Fires `prevent_audit_log_changes()` on UPDATE |
| `trg_prevent_audit_log_delete` | Trigger | Fires `prevent_audit_log_changes()` on DELETE |

**Idempotency:** All objects use `CREATE IF NOT EXISTS` or `CREATE OR REPLACE` where possible. The script is safe to re-run. On a fresh schema it installs everything; on an existing schema it is a no-op for objects that already exist.

---

## 8. Seed Execution

```bash
npm run prisma:seed
```

The seed script (`prisma/seed.ts`) is idempotent. It uses `upsert` and `findFirst` guards throughout. Running it multiple times will not create duplicate records or duplicate audit log entries.

**What the seed creates (on first run):**

| Entity | Details |
|--------|---------|
| School | 1 school, slug from `SEED_SCHOOL_SLUG` env (default: `demo-ghana-private-school`) |
| School settings | Default settings for academic scope, notifications |
| Document sequences | `student_number` and `admission_number` sequences |
| Permissions | 66 permission keys across 19 modules |
| Roles | 8 roles: `SUPER_ADMIN` (system-scoped), plus `SCHOOL_ADMIN`, `HEADTEACHER`, `ACADEMIC_COORDINATOR`, `CLASS_TEACHER`, `ADMISSIONS_OFFICER`, `PARENT_GUARDIAN`, `COMPLIANCE_OFFICER` |
| Role-permission mappings | All 66 permissions assigned to `SUPER_ADMIN` |
| Staff record | Super Admin staff record |
| User (Super Admin) | Email and phone from `SEED_SUPER_ADMIN_*` env vars; password hashed with Argon2id |
| User role | `SUPER_ADMIN` role assigned to the admin user |
| Seed audit log | One `seed.completed` entry in `audit_logs` |

**Initial credentials:**

```
Email:    admin@example.com          (or SEED_SUPER_ADMIN_EMAIL)
Password: ChangeMe123!               (or SEED_SUPER_ADMIN_PASSWORD)
```

The seed user has `mustChangePassword: true`. Stakeholders should change this password on first login via `POST /api/v1/auth/change-password`.

**Verify seed completed:**

```bash
psql "$DATABASE_URL" -c "SELECT action, created_at FROM audit_logs WHERE action = 'seed.completed';"
```

Expected output: one row with `action = seed.completed`.

---

## 9. Build

Compile TypeScript to `dist/`:

```bash
npm run build
```

This runs `nest build`, which invokes the TypeScript compiler using `tsconfig.json`. Output goes to `dist/main.js` and associated files.

**Verify the build succeeds before starting the server.** If the build fails, the server cannot start.

Pre-build type check (optional but recommended in CI):

```bash
npx tsc --noEmit
```

This runs the TypeScript compiler without emitting files. It will surface type errors without overwriting the `dist/` directory.

---

## 10. Start

### Development (hot reload)

```bash
npm run start:dev
```

Uses `nest start --watch`. Recompiles and restarts on file changes. Do not use in production.

### Production

```bash
npm run start
```

Runs `node dist/main`. Requires the build step to have completed first.

The server logs its port and prefix on startup:

```
Application running on port 3000 with prefix /api/v1
```

### One-shot fresh deployment

For a completely fresh environment with no prior data:

```bash
npm ci && npm run db:setup && npm run build && npm run start
```

`db:setup` expands to: `prisma:migrate` → `db:raw-sql` → `prisma:generate` → `prisma:seed`.

---

## 11. Process Manager

For production deployments, run the Node.js process under a process manager so it restarts on crash and survives system reboots.

### Option A — PM2 (recommended for single-server deployments)

Install PM2 globally:

```bash
npm install -g pm2
```

Start the application:

```bash
pm2 start dist/main.js --name ghana-sms-backend --env production
pm2 save
pm2 startup   # generates the init system command to auto-start on reboot
```

Useful PM2 commands:

```bash
pm2 status                      # check process status
pm2 logs ghana-sms-backend      # tail application logs
pm2 restart ghana-sms-backend   # restart after a deployment
pm2 stop ghana-sms-backend      # stop
```

### Option B — Docker (recommended for container-based deployments)

A minimal `Dockerfile` for this project:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY prisma ./prisma
COPY starter-docs/phase_1_required_raw_sql_migrations.sql ./starter-docs/
COPY scripts ./scripts
EXPOSE 3000
CMD ["node", "dist/main"]
```

Note: migrations and seeding should be run as a separate init step (init container or pre-deploy hook), not inside the application container on startup. This avoids race conditions when scaling horizontally.

### Option C — systemd (Linux servers without Docker)

Create `/etc/systemd/system/ghana-sms.service`:

```ini
[Unit]
Description=Ghana SMS Backend
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/ghana-sms-backend
EnvironmentFile=/opt/ghana-sms-backend/.env
ExecStart=/usr/bin/node dist/main.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
systemctl daemon-reload
systemctl enable ghana-sms
systemctl start ghana-sms
systemctl status ghana-sms
```

---

## 12. Health and Smoke Checks

There is no dedicated `/health` endpoint in Phase 1. Use the following proxy check.

### Server reachability check

A protected route that returns 401 (not 5xx) confirms the server is up and the database connection is healthy:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/school
```

Expected output: `401`

- `401` → server is running, auth guard is active, database is reachable.
- `5xx` → server error; check logs.
- `Connection refused` → server is not running.

### Database connectivity check

```bash
psql "$DATABASE_URL" -c "SELECT 1;"
```

Expected: `1 row`.

### Audit trigger check

Verify the immutability trigger is installed:

```bash
psql "$DATABASE_URL" -c "SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = 'audit_logs';"
```

Expected: two rows — `trg_prevent_audit_log_update` and `trg_prevent_audit_log_delete`.

### Raw SQL constraints check

Verify the partial unique indexes exist:

```bash
psql "$DATABASE_URL" -c "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'uq_%';"
```

Expected: 12 indexes prefixed with `uq_`.

---

## 13. Auth Smoke Test

Run these commands in order after deployment. Replace `BASE_URL` with your actual URL.

```bash
BASE_URL="https://your-domain.com/api/v1"
COOKIE_JAR="/tmp/sms_smoke_cookies.txt"
```

### Step 1 — Confirm server is reachable

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" "$BASE_URL/school"
# Expected: HTTP 401
```

### Step 2 — Login

```bash
LOGIN=$(curl -s -c "$COOKIE_JAR" -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"ChangeMe123!"}')

echo "$LOGIN" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Login OK' if d.get('success') else 'FAIL: '+d.get('message',''))"

ACCESS_TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['accessToken'])")
```

### Step 3 — Verify permissions in token

```bash
echo "$LOGIN" | python3 -c "
import sys, json, base64
d = json.load(sys.stdin)
token = d['data']['accessToken']
payload = token.split('.')[1]
payload += '=' * (4 - len(payload) % 4)
claims = json.loads(base64.b64decode(payload))
perms = claims.get('permissions', [])
print(f'Permissions in token: {len(perms)}')
print('Sample:', perms[:5])
"
# Expected: 66 permissions
```

### Step 4 — GET /auth/me

```bash
curl -s "$BASE_URL/auth/me" -H "Authorization: Bearer $ACCESS_TOKEN" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('success') else 'FAIL')"
# Expected: OK
```

### Step 5 — Refresh token rotation

```bash
REFRESH=$(curl -s -b "$COOKIE_JAR" -c "${COOKIE_JAR}.new" \
  -X POST "$BASE_URL/auth/refresh")
echo "$REFRESH" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Refresh OK' if d.get('success') else 'FAIL: '+d.get('message',''))"
NEW_TOKEN=$(echo "$REFRESH" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['accessToken'])")
```

### Step 6 — Logout

```bash
curl -s -b "${COOKIE_JAR}.new" \
  -H "Authorization: Bearer $NEW_TOKEN" \
  -X POST "$BASE_URL/auth/logout" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('Logout OK' if d.get('success') else 'FAIL')"
```

### Step 7 — Confirm revoked cookie is rejected

```bash
curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/auth/refresh" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('Revocation OK' if d.get('statusCode')==401 else 'FAIL: '+str(d))"
# Expected: Revocation OK
```

### Step 8 — Verify audit log and sequence

```bash
# Re-login for a fresh token
ACCESS_TOKEN=$(curl -s -c "$COOKIE_JAR" -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"ChangeMe123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['accessToken'])")

# Audit log
curl -s "$BASE_URL/audit-logs" -H "Authorization: Bearer $ACCESS_TOKEN" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); t=d['data']['pagination']['total']; print(f'Audit logs: {t}')"

# Document sequence generation
curl -s -X POST "$BASE_URL/document-sequences/student_number/generate" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('Sequence:', d['data']['formatted'] if d.get('success') else 'FAIL')"
```

All 8 steps passing confirms the deployment is healthy.

---

## 14. Postman Testing Instructions

### Import the collection

1. Open Postman (desktop application recommended — handles HTTP-only cookies correctly).
2. Click **Import**.
3. Select `postman/brite-sms.postman_collection.json`.
4. Select `postman/brite-sms.local.postman_environment.json`.
5. In the environment dropdown (top-right), select **brite-sms local**.

### Update the base URL (if not local)

If testing against a staging or production server, edit the `baseUrl` variable in the environment:

1. Click the environment name → **Edit**.
2. Change `baseUrl` to your deployed URL, e.g. `https://staging.your-domain.com/api/v1`.
3. Save.

### Login first

Every testing session must start with login:

1. Open **Auth → Create/Action /auth/login**.
2. Click **Send**.
3. The test script in that request automatically saves the returned `accessToken` to `{{accessToken}}` in the environment.
4. All subsequent requests in the collection use `{{accessToken}}` via the collection-level Bearer auth.

### Cookie handling for refresh and logout

The **refresh** (`POST /auth/refresh`) and **logout** (`POST /auth/logout`) endpoints rely on the HTTP-only refresh cookie set during login. Postman's desktop app handles this automatically via its cookie jar. If using Postman web, enable the **Postman Interceptor** browser extension to capture cookies.

### Variable placeholders

The environment file pre-fills common variables (`{{userId}}`, `{{studentId}}`, etc.) with placeholder UUIDs that will not match real data. To test endpoints that require a specific ID:

1. Run the relevant create request first.
2. Copy the `id` from the response.
3. Update the corresponding variable in the environment (e.g. set `studentId` to the copied value).

### Token expiry

Access tokens expire after `JWT_ACCESS_EXPIRES_IN` (default `15m`). If you receive a `401 Unauthorized` on a previously working request, re-run **Auth → Create/Action /auth/login** to get a fresh token.

---

## 15. Rollback Considerations

### Application code rollback

The application has no persistent in-process state. Rolling back the code means deploying the previous version of `dist/main.js` and restarting the process. No application-level rollback procedure is needed beyond that.

### Database rollback

**Prisma migration rollback is not supported in this version.** Prisma does not auto-generate down migrations. To roll back the database schema, you would need to:

1. Restore from a pre-migration database snapshot/backup, or
2. Manually reverse the schema changes with `ALTER TABLE` / `DROP TABLE` statements.

**Recommendation:** Take a full database backup immediately before running `npm run prisma:migrate` on any environment that contains data.

### Raw SQL migration rollback

The raw SQL migration is fully reversible. To remove all raw SQL objects:

```sql
-- Drop indexes
DROP INDEX IF EXISTS uq_users_school_email_lower;
DROP INDEX IF EXISTS uq_users_school_phone;
DROP INDEX IF EXISTS uq_users_school_linked_entity;
DROP INDEX IF EXISTS uq_staff_school_email_lower;
DROP INDEX IF EXISTS uq_system_role_code;
DROP INDEX IF EXISTS uq_school_role_code;
DROP INDEX IF EXISTS uq_admission_school_number;
DROP INDEX IF EXISTS uq_one_active_academic_year_per_school;
DROP INDEX IF EXISTS uq_one_active_term_per_school;
DROP INDEX IF EXISTS uq_one_primary_guardian_per_student;
DROP INDEX IF EXISTS uq_one_active_enrollment_per_student_year;

-- Drop triggers and function
DROP TRIGGER IF EXISTS trg_prevent_audit_log_update ON audit_logs;
DROP TRIGGER IF EXISTS trg_prevent_audit_log_delete ON audit_logs;
DROP FUNCTION IF EXISTS prevent_audit_log_changes();
```

CHECK constraints added by `ALTER TABLE` would need to be identified and dropped individually using `ALTER TABLE ... DROP CONSTRAINT <name>`.

### Seed rollback

The seed script cannot be automatically reversed. To reset seed data, either restore a database backup or manually delete the seeded records. A complete database wipe and re-seed is safe on a fresh environment.

---

## 16. Common Deployment Issues and Fixes

### Server fails to start: `Environment validation failed`

```
Environment validation failed: DATABASE_URL must be a string; COOKIE_SECURE must be one of ...
```

**Fix:** One or more required environment variables are missing or have an invalid value. Check the error message — each constraint violation is listed. Edit `.env` and restart.

---

### `npm run prisma:migrate` fails: `P1001 Can't reach database server`

```
Error: P1001: Can't reach database server at 'host:5432'
```

**Fix:** The `DATABASE_URL` is incorrect or the database server is unreachable. Verify:

1. The database host and port are correct.
2. Network/firewall rules allow the connection from the deployment host.
3. The PostgreSQL service is running: `pg_isready -h host -p 5432`

---

### `npm run db:raw-sql` fails: `psql: command not found`

**Fix:** The `psql` CLI client is not installed on the machine running the script. Install it:

```bash
# Ubuntu/Debian
apt-get install postgresql-client

# macOS
brew install libpq && brew link --force libpq

# Amazon Linux / RHEL
yum install postgresql
```

Alternatively, run the raw SQL migration from a machine that has `psql` installed and has network access to the database.

---

### `npm run db:raw-sql` fails: `ERROR: must be owner of extension pgcrypto`

**Fix:** The database user does not have permission to create extensions. Have a superuser run:

```bash
psql -U postgres -d your_database -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
```

Then re-run `npm run db:raw-sql`. The script will skip the already-installed extension.

---

### `npm run prisma:seed` fails: `P2025 Record to update not found`

**Fix:** The seed expects certain tables to exist. This error means `npm run prisma:migrate` did not complete successfully. Re-run the migration, then re-run the seed.

---

### Login returns `401 Invalid credentials` after fresh seed

**Fix:** The seed password was not hashed correctly, or the `SEED_SUPER_ADMIN_PASSWORD` environment variable differs from what you are using to log in. Verify:

1. `SEED_SUPER_ADMIN_PASSWORD` in `.env` matches the password you're testing with.
2. Re-run the seed: `npm run prisma:seed`. The seed is idempotent and will update the password hash if the user already exists.

---

### Refresh token returns `401` immediately after login

**Cause:** The refresh cookie was not stored. This is usually because `COOKIE_SECURE=true` is set but the request is over HTTP (not HTTPS).

**Fix:** Either:
- Set `COOKIE_SECURE=false` for local/HTTP testing, or
- Ensure all requests go through HTTPS.

---

### All `/files` endpoints return `500`

**Fix:** This is the BigInt serialization bug, which was fixed in Phase 1 QA. Ensure you are running the latest code (`src/files/files.service.ts` includes the `serialize()` helper). Re-run `npm run build` and restart.

---

### `POST /admissions/:id/offer` returns `500`

**Fix:** This is the `approvedBy` Staff FK bug, which was fixed in Phase 1 QA. Ensure you are running the latest code (`src/admissions/admissions.service.ts` does not set `approvedBy` in the offer update). Re-run `npm run build` and restart.

---

### CORS error in browser / Postman web

```
Access to XMLHttpRequest blocked by CORS policy: No 'Access-Control-Allow-Origin' header
```

**Fix:** The `CORS_ORIGIN` environment variable does not match the origin of the request. Set it to the exact origin (scheme + host + port) of the client. Desktop Postman does not enforce CORS — this error only appears in browser-based clients.

---

### Postman `POST /enrollments` returns `400 Validation Failed: property enrollmentDate should not exist`

**Fix:** You may be using an old version of the Postman collection. The `enrollmentDate` field was removed from the enrollment create body in the Phase 1 QA fix. Re-import `postman/brite-sms.postman_collection.json` from the repository.

---

## 17. Security Checklist

Work through this list before any external stakeholder gains access to the deployment.

### Secrets

- [ ] `JWT_ACCESS_SECRET` is at least 32 random characters and is not the example value
- [ ] `TOKEN_HASH_SECRET` is at least 32 random characters, is not the example value, and is **different** from `JWT_ACCESS_SECRET`
- [ ] `SEED_SUPER_ADMIN_PASSWORD` is not committed to source control
- [ ] `.env` is listed in `.gitignore` and is not tracked in the repository
- [ ] No secrets appear in logs, error messages, or audit log entries

### Network

- [ ] The application port (3000) is not exposed directly to the internet; traffic goes through a reverse proxy
- [ ] HTTPS is enforced at the reverse proxy; HTTP is either rejected or redirected to HTTPS
- [ ] The PostgreSQL port (5432) is not publicly accessible; only the application server can connect
- [ ] `CORS_ORIGIN` is set to the exact client origin — not `*`

### Cookies

- [ ] `COOKIE_SECURE=true` — refresh cookie is only sent over HTTPS
- [ ] `COOKIE_HTTP_ONLY=true` — refresh cookie cannot be read by JavaScript (set in application code; not an env variable)
- [ ] `COOKIE_SAME_SITE=strict` or `lax` — not `none` unless a specific cross-site use case requires it

### Authentication

- [ ] Super Admin password has been changed from the seed default (`ChangeMe123!`)
- [ ] Rate limiting is confirmed active on auth endpoints (`@nestjs/throttler` is wired in AppModule)
- [ ] Refresh token is stored only as an HMAC-SHA256 hash — the raw token is never persisted

### Database

- [ ] Audit log immutability trigger is installed (see health check in Section 12)
- [ ] All raw SQL partial indexes are installed (see health check in Section 12)
- [ ] The database user used by the application has only the minimum required privileges — not superuser in production

### Application

- [ ] `NODE_ENV=production` is set — disables development-mode stack traces in error responses
- [ ] Helmet security headers are confirmed in responses: `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security` (requires HTTPS)
- [ ] Response compression is active (confirmed by `Content-Encoding: gzip` on large responses)
- [ ] `whitelist: true` global validation is active — unknown request fields are rejected with 400

---

## 18. Final Go-Live Checklist

This is the definitive sign-off checklist before opening the deployment to stakeholders or external users.

### Infrastructure

- [ ] PostgreSQL instance is running and accessible from the application host
- [ ] Node.js 20+ LTS is installed
- [ ] HTTPS is configured and working at the reverse proxy layer
- [ ] The application port is not directly exposed to the internet

### Code and Build

- [ ] `git pull` / `git checkout` confirms you are on the correct branch and commit
- [ ] `npm ci` installed cleanly (no errors, lockfile respected)
- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] `npm test` passes: 81 tests, 10 suites, all green
- [ ] `npm run build` completed without errors
- [ ] `dist/main.js` exists and is not empty

### Database

- [ ] `npm run prisma:validate` passes
- [ ] `npm run prisma:migrate` applied the migration successfully
- [ ] `npm run db:raw-sql` applied the raw SQL successfully
- [ ] 12 `uq_*` indexes confirmed in `pg_indexes`
- [ ] 2 audit log triggers confirmed in `information_schema.triggers`
- [ ] `npm run prisma:seed` completed without errors
- [ ] Seed audit log entry confirmed in `audit_logs`

### Environment

- [ ] All required environment variables set (see Section 2)
- [ ] `JWT_ACCESS_SECRET` and `TOKEN_HASH_SECRET` are different, long, and random
- [ ] `COOKIE_SECURE=true`
- [ ] `NODE_ENV=production`
- [ ] Application starts and logs port and prefix without errors

### Auth Smoke Test

- [ ] `GET /api/v1/school` returns `401` (not `5xx`)
- [ ] `POST /api/v1/auth/login` returns `success: true` with access token
- [ ] `GET /api/v1/auth/me` returns correct user with 66 permissions
- [ ] `POST /api/v1/auth/refresh` returns a new access token and rotates cookie
- [ ] `POST /api/v1/auth/logout` returns `success: true`
- [ ] Reusing the revoked cookie returns `401`

### Security

- [ ] Admin password changed from `ChangeMe123!`
- [ ] Helmet headers confirmed in response (`curl -I ...`)
- [ ] HTTPS enforced (HTTP requests redirect or are rejected)
- [ ] CORS returns correct `Access-Control-Allow-Origin` header for allowed origins

### Postman

- [ ] Collection and environment imported successfully
- [ ] Login request succeeds and populates `{{accessToken}}`
- [ ] At least one resource from each module group returns `success: true`

### Stakeholder Access

- [ ] Stakeholders have been given the Postman collection and environment files
- [ ] Stakeholders have been given login credentials (not the seed defaults — new credentials should be issued)
- [ ] Stakeholders have been informed that access tokens expire after 15 minutes and they should re-run the login request to get a fresh token
- [ ] A point of contact for technical issues has been designated

---

*This guide covers the Phase 1 backend only. Phase 2 modules, frontend deployment, and production infrastructure hardening are not in scope here.*
