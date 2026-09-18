/**
 * One-time backfill: assigns admission numbers to admissions created before
 * auto-assignment shipped (Phase 1B item 1).
 *
 *   npm run backfill:admission-numbers
 *
 * Rules:
 *  - Only rows with admission_number IS NULL are touched.
 *  - Oldest first (application_date, then created_at), so numbers roughly
 *    follow chronology.
 *  - Each number is claimed from the school's admission_number document
 *    sequence inside the same transaction as the row update — the sequence
 *    therefore ends above every issued number and live creation continues
 *    cleanly. Consuming sequence values here is intentional and required.
 *  - Values already taken manually are skipped automatically (bounded retry
 *    per row on unique violation).
 *
 * Idempotent: a second run finds zero null rows and does nothing.
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function nextNumber(tx: Prisma.TransactionClient, schoolId: string) {
  const seq = await tx.documentSequence.update({
    where: { schoolId_type: { schoolId, type: 'admission_number' } },
    data: { currentNumber: { increment: 1 } },
  });
  const padded = String(seq.currentNumber).padStart(seq.paddingLength, '0');
  return seq.prefix ? `${seq.prefix}-${padded}` : padded;
}

async function main() {
  const rows = await prisma.admissionApplication.findMany({
    where: { admissionNumber: null },
    orderBy: [{ applicationDate: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, schoolId: true, applicationDate: true },
  });
  console.log(`Backfilling ${rows.length} admission(s) with null numbers…`);

  let assigned = 0;
  for (const row of rows) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const number = await prisma.$transaction(async (tx) => {
          const n = await nextNumber(tx, row.schoolId);
          await tx.admissionApplication.update({
            where: { id: row.id },
            data: { admissionNumber: n },
          });
          return n;
        });
        console.log(`  ${row.id} → ${number}`);
        assigned++;
        break;
      } catch (err) {
        const isUnique =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002';
        if (isUnique && attempt < 3) continue; // manual number in the path — take the next value
        throw err;
      }
    }
  }
  console.log(`Done — ${assigned} assigned.`);
}

main()
  .catch((e) => {
    console.error('Backfill failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
