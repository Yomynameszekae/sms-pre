-- Phase 2: the SMS notification layer, and SMS consent on Guardian.
-- Hand-written per README Rule 1 (`prisma migrate deploy`, never
-- `migrate dev`).
--
-- One table, three enums, four columns on guardians. Nothing here drops or
-- recreates an existing table, so all 29 raw-SQL objects survive; `npm run
-- db:raw-sql` still runs after this to add uq_notification_dedupe, which
-- Prisma cannot express.
--
-- CONSENT DEFAULTS TO FALSE, DELIBERATELY. Every existing guardian row
-- therefore becomes non-messageable the moment this applies, and stays that
-- way until a member of staff records consent against their name. Defaulting
-- to true would manufacture consent for every guardian already in the
-- database, which is the opposite of what a consent record is for.

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('sms');

-- CreateEnum
CREATE TYPE "notification_trigger" AS ENUM ('fee_reminder', 'fee_receipt', 'attendance_absence', 'account_setup', 'password_reset', 'announcement');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('queued', 'sending', 'sent', 'delivered', 'failed', 'suppressed', 'cancelled');

-- AlterTable
ALTER TABLE "guardians" ADD COLUMN "sms_consent_given" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "guardians" ADD COLUMN "sms_consent_given_at" TIMESTAMPTZ(6);
ALTER TABLE "guardians" ADD COLUMN "sms_consent_given_by" UUID;
ALTER TABLE "guardians" ADD COLUMN "sms_consent_method" VARCHAR(60);

-- CreateTable
CREATE TABLE "notification_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "channel" "notification_channel" NOT NULL DEFAULT 'sms',
    "trigger" "notification_trigger" NOT NULL,
    "status" "notification_status" NOT NULL DEFAULT 'queued',
    "guardian_id" UUID,
    "student_id" UUID,
    "user_id" UUID,
    "to_phone" VARCHAR(30) NOT NULL,
    "body" TEXT NOT NULL,
    "segment_count" INTEGER NOT NULL,
    "dedupe_key" VARCHAR(160),
    "context_type" VARCHAR(50),
    "context_id" UUID,
    "batch_id" UUID,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "provider_code" VARCHAR(40),
    "provider_message_id" VARCHAR(120),
    "last_error" VARCHAR(255),
    "queued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "notification_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_messages_school_id_idx" ON "notification_messages"("school_id");
CREATE INDEX "notification_messages_school_id_status_idx" ON "notification_messages"("school_id", "status");
CREATE INDEX "notification_messages_status_next_attempt_at_idx" ON "notification_messages"("status", "next_attempt_at");
CREATE INDEX "notification_messages_guardian_id_idx" ON "notification_messages"("guardian_id");
CREATE INDEX "notification_messages_context_type_context_id_idx" ON "notification_messages"("context_type", "context_id");
CREATE INDEX "notification_messages_batch_id_idx" ON "notification_messages"("batch_id");

-- AddForeignKey
ALTER TABLE "notification_messages" ADD CONSTRAINT "notification_messages_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification_messages" ADD CONSTRAINT "notification_messages_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notification_messages" ADD CONSTRAINT "notification_messages_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notification_messages" ADD CONSTRAINT "notification_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
