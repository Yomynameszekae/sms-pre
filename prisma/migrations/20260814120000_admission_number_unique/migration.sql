-- Admission numbers become auto-assigned and unique per school (Phase 1B item 1).
-- Index name follows Prisma's convention for @@unique([schoolId, admissionNumber])
-- so schema diffs recognise it. admission_number is nullable; Postgres treats
-- NULLs as distinct, so pre-backfill rows do not collide.
CREATE UNIQUE INDEX "admission_applications_school_id_admission_number_key"
  ON "admission_applications"("school_id", "admission_number");
