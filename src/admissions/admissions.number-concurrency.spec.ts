/**
 * INTEGRATION test — runs against the real database (DATABASE_URL), because
 * the property under test is Postgres row-lock serialisation of the document
 * sequence, which mocks cannot exercise.
 *
 * Fires N concurrent creates through the real AdmissionsService and asserts
 * N distinct admission numbers with no P2002 escaping to the caller.
 * Cleans up the created rows and restores the sequence afterwards, so the
 * demo dataset is left untouched. (Audit writes are mocked out — the audit
 * table is immutable and would otherwise accrete test entries.)
 */
import { PrismaClient } from '@prisma/client';
import { AdmissionsService } from './admissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

const N = 8;

describe('Admission number assignment under concurrency (integration)', () => {
  const prisma = new PrismaClient();
  const auditMock = { create: jest.fn().mockResolvedValue(undefined) };
  const service = new AdmissionsService(
    prisma as unknown as PrismaService,
    auditMock as unknown as AuditLogsService,
  );

  let schoolId: string;
  let userId: string;
  let sequenceBefore: number;
  const createdIds: string[] = [];

  beforeAll(async () => {
    const school = await prisma.school.findFirst();
    if (!school) throw new Error('No school in database — run prisma:seed first');
    schoolId = school.id;
    const user = await prisma.user.findFirst({ where: { schoolId } });
    userId = user?.id ?? 'concurrency-test';
    const seq = await prisma.documentSequence.findUnique({
      where: { schoolId_type: { schoolId, type: 'admission_number' } },
    });
    if (!seq) throw new Error('No admission_number sequence — run prisma:seed first');
    sequenceBefore = seq.currentNumber;
  });

  afterAll(async () => {
    if (createdIds.length) {
      await prisma.admissionApplication.deleteMany({
        where: { id: { in: createdIds } },
      });
    }
    // Restore the sequence so repeated test runs don't walk the demo's
    // advertised "next number" forward.
    await prisma.documentSequence.update({
      where: { schoolId_type: { schoolId, type: 'admission_number' } },
      data: { currentNumber: sequenceBefore },
    });
    await prisma.$disconnect();
  });

  it(`assigns ${N} distinct numbers to ${N} concurrent creates`, async () => {
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        service.create(
          { notes: `concurrency test ${i}` },
          userId,
          schoolId,
        ),
      ),
    );
    createdIds.push(...results.map((r) => r.id));

    const numbers = results.map((r) => r.admissionNumber);
    expect(numbers.every((n) => /^ADM-\d{4,}$/.test(n ?? ''))).toBe(true);
    expect(new Set(numbers).size).toBe(N);

    const seqAfter = await prisma.documentSequence.findUnique({
      where: { schoolId_type: { schoolId, type: 'admission_number' } },
    });
    expect(seqAfter!.currentNumber).toBe(sequenceBefore + N);
  }, 30000);
});
