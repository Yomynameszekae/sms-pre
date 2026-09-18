-- Phase 1B item 2: the admission pipeline gains a 'withdrawn' terminal state
-- (family declines the school — distinct from 'rejected', school declines the
-- family). Enum value addition is additive and IRREVERSIBLE in Postgres.
ALTER TYPE "admission_status" ADD VALUE IF NOT EXISTS 'withdrawn';

-- Belt-and-braces for fresh environments: the raw-SQL partial index on
-- admission numbers was superseded by the Prisma-owned unique in
-- 20260814120000_admission_number_unique and removed from the raw-SQL file;
-- drop it wherever it still exists.
DROP INDEX IF EXISTS "uq_admission_school_number";
