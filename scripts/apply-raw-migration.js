#!/usr/bin/env node
/**
 * Applies every raw-SQL file in starter-docs/ to the database, in phase order.
 *
 * These files hold the ~25 database objects Prisma cannot express — partial
 * unique indexes, expression uniques, CHECK constraints and the audit-log
 * immutability trigger. They are part of the schema, not an optional extra:
 * see the "the raw SQL is part of the schema" rule in ../README.md, which also
 * carries the complete cross-phase inventory.
 *
 * The set is split ONE FILE PER PHASE rather than accumulating in a single
 * file. Phase 1's filename is referenced by the frozen Phase 1 handoff and
 * deployment documents, so it must keep both its name and its contents; a
 * later phase appending to it would make that name a lie. Add a new phase by
 * adding a file and one entry to SQL_FILES.
 *
 * Every file is idempotent (IF NOT EXISTS on indexes, a duplicate_object guard
 * around each ADD CONSTRAINT, CREATE OR REPLACE for the function and
 * triggers), so this is safe to re-run — which `db:setup` and the
 * belt-and-braces re-run after `prisma migrate deploy` both rely on.
 *
 * Loads DATABASE_URL from .env if present, then runs psql.
 *
 * Usage:
 *   npm run db:raw-sql
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Applied in this order. Later phases may depend on tables created earlier,
// so the order is significant — append, never insert.
const SQL_FILES = [
  'phase_1_required_raw_sql_migrations.sql',
  'phase_2_required_raw_sql_migrations.sql',
];

// Load .env if it exists (dotenv is a transitive dep of @nestjs/config)
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('ERROR: DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const resolved = SQL_FILES.map((name) => ({
  name,
  file: path.resolve(__dirname, '../starter-docs', name),
}));

// Resolve every path before applying any of them: a half-applied set is worse
// than a clean refusal, and a missing file means the checkout is incomplete.
const missing = resolved.filter(({ file }) => !fs.existsSync(file));
if (missing.length) {
  for (const { file } of missing) {
    console.error(`ERROR: SQL file not found at ${file}`);
  }
  process.exit(1);
}

console.log(`Applying raw SQL migrations (${resolved.length} files)...`);

for (const { name, file } of resolved) {
  console.log(`  SQL: ${name}`);
  try {
    // ON_ERROR_STOP: without it psql reports success after a failed statement,
    // which would let a missing constraint reach production silently.
    execSync(`psql -v ON_ERROR_STOP=1 "${databaseUrl}" -f "${file}"`, { stdio: 'inherit' });
  } catch (err) {
    console.error(`Raw SQL migration failed in ${name}. Check output above for details.`);
    process.exit(1);
  }
}

console.log('Raw SQL migrations applied successfully.');
