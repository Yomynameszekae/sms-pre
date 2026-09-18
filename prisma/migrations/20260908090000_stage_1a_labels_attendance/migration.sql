-- Phase 2 Stage 1a: the shared Label classification and the attendance
-- register core. Hand-written per README Rule 1 (`prisma migrate deploy`,
-- never `migrate dev` — drift detection would offer to reset the database and
-- destroy the raw-SQL constraint set).
--
-- Two new tables and two new enum types. NOTHING here creates, drops or
-- recreates enrollments, academic_years, terms or student_guardians, so the
-- four raw-SQL partial indexes survive untouched. `npm run db:raw-sql` still
-- runs after this to add uq_label_school_category_name_lower, which the labels
-- table below deliberately does NOT declare (Prisma cannot express an
-- expression index; see the note on `model Label` in schema.prisma).

-- CreateEnum
CREATE TYPE "label_category" AS ENUM ('fee', 'income', 'expenditure');

-- CreateEnum
CREATE TYPE "attendance_status" AS ENUM ('present', 'absent', 'late', 'excused');

-- CreateTable
CREATE TABLE "labels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "category" "label_category" NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "attendance_date" DATE NOT NULL,
    "status" "attendance_status" NOT NULL,
    "reason" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "labels_school_id_idx" ON "labels"("school_id");

-- CreateIndex
CREATE INDEX "labels_school_id_category_idx" ON "labels"("school_id", "category");

-- CreateIndex
CREATE INDEX "attendance_records_school_id_idx" ON "attendance_records"("school_id");

-- CreateIndex
CREATE INDEX "attendance_records_enrollment_id_idx" ON "attendance_records"("enrollment_id");

-- CreateIndex
CREATE INDEX "attendance_records_school_id_attendance_date_idx" ON "attendance_records"("school_id", "attendance_date");

-- CreateIndex
-- One record per student per date. Named in Prisma's own convention so schema
-- diffs recognise it.
CREATE UNIQUE INDEX "attendance_records_enrollment_id_attendance_date_key" ON "attendance_records"("enrollment_id", "attendance_date");

-- AddForeignKey
ALTER TABLE "labels" ADD CONSTRAINT "labels_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
