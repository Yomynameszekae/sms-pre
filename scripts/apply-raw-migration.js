#!/usr/bin/env node
/**
 * Applies starter-docs/phase_1_required_raw_sql_migrations.sql to the database.
 *
 * Loads DATABASE_URL from .env if present, then runs psql.
 * Run after `npm run prisma:migrate`.
 *
 * Usage:
 *   npm run prisma:migrate:raw
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

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

const sqlFile = path.resolve(__dirname, '../starter-docs/phase_1_required_raw_sql_migrations.sql');
if (!fs.existsSync(sqlFile)) {
  console.error(`ERROR: SQL file not found at ${sqlFile}`);
  process.exit(1);
}

console.log('Applying raw SQL migration...');
console.log(`  SQL: ${sqlFile}`);

try {
  execSync(`psql "${databaseUrl}" -f "${sqlFile}"`, { stdio: 'inherit' });
  console.log('Raw SQL migration applied successfully.');
} catch (err) {
  console.error('Raw SQL migration failed. Check output above for details.');
  process.exit(1);
}
