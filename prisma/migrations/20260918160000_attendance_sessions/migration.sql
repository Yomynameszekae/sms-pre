-- Phase 2 Part B: session-level attendance. A register row stops saying one
-- thing about a whole day and says one thing about each half of it.
--
-- Hand-written per README Rule 1 (`prisma migrate deploy`, never
-- `migrate dev` — drift detection would offer to reset the database and
-- destroy the raw-SQL constraint set).
--
-- `status` is REPLACED, not supplemented. There is deliberately no transition
-- period in which both a day-level and a session-level column exist: two
-- columns claiming to say whether a child was in school is precisely the
-- defect the single-reporting-rule discipline exists to prevent. The schema
-- change and the code change therefore land together.
--
-- NO RAW-SQL INVENTORY CHANGE. The only index on this table is
-- attendance_records_enrollment_id_attendance_date_key, which names neither
-- renamed column, so it survives the rename untouched. The README raw-SQL
-- inventory is unchanged by this migration.
--
-- THE HONEST CAVEAT ON THE BACKFILL, for whoever later plots a PM series:
-- setting afternoon := morning is a faithful *restatement* of what a
-- day-level record meant, and it is the only defensible reading. It is not an
-- observation. Nobody recorded the afternoon of any pre-migration day. Day
-- level figures over historical data stay exactly correct — a term summary
-- printed before this migration and after it shows the same percentage,
-- because a row contributing p/n under the day rule contributes 2p/2n under
-- the session rule (this is asserted directly, against real pre-migration
-- seeded data, by attendance.rate-neutrality.spec.ts). But any analysis that
-- treats pre-migration afternoons as independently observed is reading
-- something into the data that was never there. The genuinely observed PM
-- series starts at this migration, not at the first attendance row.
--
-- One value reads oddly and is nonetheless correct: a day marked `late`
-- backfills to late/late, and a child cannot arrive late to the afternoon of
-- a day they were already present for. The day rule counted that `late` as
-- present once out of one; the session rule counts it as present twice out of
-- two. Same proportion, which is the property that matters here.

-- 1. Rename in place. A catalog operation: no row rewrite, no lock beyond the
--    brief ACCESS EXCLUSIVE the ALTER takes.
ALTER TABLE "attendance_records" RENAME COLUMN "status" TO "morning_status";
ALTER TABLE "attendance_records" RENAME COLUMN "reason" TO "morning_reason";

-- 2. Add the afternoon, nullable for now.
ALTER TABLE "attendance_records" ADD COLUMN "afternoon_status" "attendance_status";
ALTER TABLE "attendance_records" ADD COLUMN "afternoon_reason" VARCHAR(255);

-- 3. Backfill: a Stage 1a row said one thing about the whole day, so it says
--    the same thing about both halves of it.
--
--    afternoon_reason is deliberately NOT backfilled from morning_reason. A
--    note written about a day applies to the session that deviated; copying
--    it would assert something about the afternoon that nobody recorded.
UPDATE "attendance_records" SET "afternoon_status" = "morning_status";

-- 4. Now it can be NOT NULL. Deliberately no DEFAULT — a default would let a
--    future insert silently create a row with an unstated afternoon.
ALTER TABLE "attendance_records" ALTER COLUMN "afternoon_status" SET NOT NULL;
