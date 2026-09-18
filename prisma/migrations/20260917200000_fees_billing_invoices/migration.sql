-- Phase 2 Stage 1b: fees and billing, plus the Invoice document.
-- Hand-written per README Rule 1 (`prisma migrate deploy`, never
-- `migrate dev` — drift detection would offer to reset the database and
-- destroy the raw-SQL constraint set).
--
-- Six tables and two enum types. NOTHING here creates, drops or recreates an
-- existing table, so all twelve raw-SQL objects survive untouched.
--
-- `npm run db:raw-sql` still runs after this to add the four objects Prisma
-- cannot express for these tables: two CHECK constraints on fee_payments and
-- two partial unique indexes. See phase_2_required_raw_sql_migrations.sql.

-- CreateEnum
CREATE TYPE "fee_payment_method" AS ENUM ('mobile_money', 'cash', 'bank_transfer', 'cheque', 'card');

-- CreateEnum
CREATE TYPE "invoice_status" AS ENUM ('issued', 'cancelled');

-- CreateTable
CREATE TABLE "fee_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "label_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "fee_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_fees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "fee_type_id" UUID NOT NULL,
    "level_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "school_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "school_fee_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "amount_due" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "fee_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "fee_assignment_id" UUID NOT NULL,
    "receipt_number" VARCHAR(50),
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "fee_payment_method" NOT NULL,
    "provider_code" VARCHAR(30),
    "reference" VARCHAR(100),
    "paid_on" DATE NOT NULL,
    "notes" TEXT,
    "reverses_payment_id" UUID,
    "reversal_reason" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "fee_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "invoice_number" VARCHAR(50) NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "status" "invoice_status" NOT NULL DEFAULT 'issued',
    "issued_on" DATE NOT NULL,
    "due_on" DATE,
    "notes" TEXT,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" UUID,
    "cancellation_reason" VARCHAR(500),
    "supersedes_invoice_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "fee_assignment_id" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fee_types_school_id_idx" ON "fee_types"("school_id");
CREATE INDEX "fee_types_label_id_idx" ON "fee_types"("label_id");
CREATE UNIQUE INDEX "fee_types_school_id_name_key" ON "fee_types"("school_id", "name");

-- CreateIndex
CREATE INDEX "school_fees_school_id_idx" ON "school_fees"("school_id");
CREATE INDEX "school_fees_school_id_academic_year_id_term_id_idx" ON "school_fees"("school_id", "academic_year_id", "term_id");
CREATE INDEX "school_fees_level_id_idx" ON "school_fees"("level_id");
CREATE UNIQUE INDEX "school_fees_school_id_fee_type_id_level_id_academic_year_id__key" ON "school_fees"("school_id", "fee_type_id", "level_id", "academic_year_id", "term_id");

-- CreateIndex
CREATE INDEX "fee_assignments_school_id_idx" ON "fee_assignments"("school_id");
CREATE INDEX "fee_assignments_enrollment_id_idx" ON "fee_assignments"("enrollment_id");
CREATE UNIQUE INDEX "fee_assignments_school_fee_id_enrollment_id_key" ON "fee_assignments"("school_fee_id", "enrollment_id");

-- CreateIndex
CREATE INDEX "fee_payments_school_id_idx" ON "fee_payments"("school_id");
CREATE INDEX "fee_payments_fee_assignment_id_idx" ON "fee_payments"("fee_assignment_id");
CREATE INDEX "fee_payments_school_id_paid_on_idx" ON "fee_payments"("school_id", "paid_on");
CREATE UNIQUE INDEX "fee_payments_school_id_receipt_number_key" ON "fee_payments"("school_id", "receipt_number");

-- CreateIndex
CREATE INDEX "invoices_school_id_idx" ON "invoices"("school_id");
CREATE INDEX "invoices_enrollment_id_idx" ON "invoices"("enrollment_id");
CREATE INDEX "invoices_school_id_term_id_idx" ON "invoices"("school_id", "term_id");
CREATE INDEX "invoices_status_idx" ON "invoices"("status");
CREATE UNIQUE INDEX "invoices_supersedes_invoice_id_key" ON "invoices"("supersedes_invoice_id");
CREATE UNIQUE INDEX "invoices_school_id_invoice_number_key" ON "invoices"("school_id", "invoice_number");

-- CreateIndex
CREATE INDEX "invoice_lines_school_id_idx" ON "invoice_lines"("school_id");
CREATE INDEX "invoice_lines_fee_assignment_id_idx" ON "invoice_lines"("fee_assignment_id");
CREATE UNIQUE INDEX "invoice_lines_invoice_id_fee_assignment_id_key" ON "invoice_lines"("invoice_id", "fee_assignment_id");

-- AddForeignKey
ALTER TABLE "fee_types" ADD CONSTRAINT "fee_types_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fee_types" ADD CONSTRAINT "fee_types_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "school_fees" ADD CONSTRAINT "school_fees_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "school_fees" ADD CONSTRAINT "school_fees_fee_type_id_fkey" FOREIGN KEY ("fee_type_id") REFERENCES "fee_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "school_fees" ADD CONSTRAINT "school_fees_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "school_fees" ADD CONSTRAINT "school_fees_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "school_fees" ADD CONSTRAINT "school_fees_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fee_assignments" ADD CONSTRAINT "fee_assignments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fee_assignments" ADD CONSTRAINT "fee_assignments_school_fee_id_fkey" FOREIGN KEY ("school_fee_id") REFERENCES "school_fees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fee_assignments" ADD CONSTRAINT "fee_assignments_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_fee_assignment_id_fkey" FOREIGN KEY ("fee_assignment_id") REFERENCES "fee_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_reverses_payment_id_fkey" FOREIGN KEY ("reverses_payment_id") REFERENCES "fee_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_supersedes_invoice_id_fkey" FOREIGN KEY ("supersedes_invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_fee_assignment_id_fkey" FOREIGN KEY ("fee_assignment_id") REFERENCES "fee_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
