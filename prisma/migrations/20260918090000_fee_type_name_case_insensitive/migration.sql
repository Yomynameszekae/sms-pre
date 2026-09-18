-- The plain unique on (school_id, name) is replaced by a CASE-INSENSITIVE
-- expression index, applied by `npm run db:raw-sql`
-- (uq_fee_type_school_name_lower). Prisma cannot express lower(name), so the
-- schema now declares no unique on FeeType and the raw-SQL set owns the rule
-- outright — the same arrangement as `labels`.
DROP INDEX IF EXISTS "fee_types_school_id_name_key";
