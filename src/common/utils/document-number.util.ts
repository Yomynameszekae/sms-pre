import { DocumentSequenceType, Prisma } from '@prisma/client';

/**
 * Claims the next document number for a school inside the caller's
 * transaction.
 *
 * The single UPDATE … increment takes a row-level lock on the sequence row,
 * so concurrent claims serialise in Postgres and can never yield the same
 * number. Because the caller passes its transaction client, the increment
 * commits or rolls back together with the record that consumes the number.
 *
 * Numbers are unique, not gap-free: a manually assigned number can occupy a
 * value the sequence has not reached yet, in which case the caller's insert
 * fails with P2002 — callers handle that with a bounded retry (claim the next
 * value and try again), not by reusing numbers.
 */
export async function nextDocumentNumber(
  tx: Prisma.TransactionClient,
  schoolId: string,
  type: DocumentSequenceType,
): Promise<string> {
  const seq = await tx.documentSequence.update({
    where: { schoolId_type: { schoolId, type } },
    data: { currentNumber: { increment: 1 } },
  });
  const padded = String(seq.currentNumber).padStart(seq.paddingLength, '0');
  return seq.prefix ? `${seq.prefix}-${padded}` : padded;
}

/** True when a P2002 unique violation is about the given column/index hint. */
export function isUniqueViolationOn(err: unknown, hint: RegExp): boolean {
  if (
    !(err instanceof Prisma.PrismaClientKnownRequestError) ||
    err.code !== 'P2002'
  ) {
    return false;
  }
  return hint.test(JSON.stringify(err.meta?.target ?? ''));
}
