import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { Prisma, LabelCategory } from '@prisma/client';
import { LabelsService, normaliseLabelName } from './labels.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

/**
 * The label rules that matter: per-CATEGORY uniqueness (the fix for the
 * benchmarked product's defect D06) and case-insensitive collision.
 *
 * Both rules are enforced by the raw-SQL expression index
 * uq_label_school_category_name_lower, so what is testable here is the
 * SERVICE's half: that it does not pre-empt the database with a check of its
 * own, and that it turns a P2002 into a 409 naming the right category. The
 * database's half is proved against real Postgres by the QA script — a unit
 * test with a mocked client could "prove" any rule at all.
 */
const mockPrisma: any = {
  label: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
};
const mockAuditLogs = { create: jest.fn() };

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.14.0',
    meta: { target: 'uq_label_school_category_name_lower' },
  });
}

async function makeService(): Promise<LabelsService> {
  const module = await Test.createTestingModule({
    providers: [
      LabelsService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: AuditLogsService, useValue: mockAuditLogs },
    ],
  }).compile();
  return module.get(LabelsService);
}

beforeEach(() => jest.clearAllMocks());

describe('normaliseLabelName', () => {
  it('trims and collapses internal whitespace', () => {
    expect(normaliseLabelName('  Tuition   Fees  ')).toBe('Tuition Fees');
  });

  it('leaves an already-clean name alone', () => {
    expect(normaliseLabelName('Tuition')).toBe('Tuition');
  });
});

describe('Label — per-category uniqueness (defect D06 fix)', () => {
  it('does not pre-check for duplicates: the index is the only rule', async () => {
    const svc = await makeService();
    mockPrisma.label.create.mockResolvedValue({ id: 'l1', category: 'fee', name: 'Transport' });

    await svc.create(
      { category: LabelCategory.fee, name: 'Transport' },
      'u1',
      's1',
    );

    // A pre-flight SELECT would race two concurrent creates through the gap
    // between the check and the insert.
    expect(mockPrisma.label.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.label.create).toHaveBeenCalledTimes(1);
  });

  it('allows the same name in a different category', async () => {
    const svc = await makeService();

    // The database index is (school_id, category, lower(name)) — a fee
    // "Transport" and an income "Transport" occupy different keys, so the
    // insert simply succeeds. This is the case the benchmarked product's
    // globally-unique names made impossible.
    mockPrisma.label.create.mockResolvedValue({ id: 'l2', category: 'income', name: 'Transport' });

    await expect(
      svc.create({ category: LabelCategory.income, name: 'Transport' }, 'u1', 's1'),
    ).resolves.toMatchObject({ category: 'income', name: 'Transport' });
  });

  it('maps a unique violation to a 409 naming the category', async () => {
    const svc = await makeService();
    mockPrisma.label.create.mockRejectedValue(uniqueViolation());

    await expect(
      svc.create({ category: LabelCategory.expenditure, name: 'Salaries' }, 'u1', 's1'),
    ).rejects.toThrow(
      new ConflictException(
        "A expenditure label named 'Salaries' already exists in this school",
      ),
    );
  });
});

describe('Label — case-insensitive collision', () => {
  it('normalises before insert so the lower() index sees a clean name', async () => {
    const svc = await makeService();
    mockPrisma.label.create.mockResolvedValue({ id: 'l3' });

    await svc.create({ category: LabelCategory.fee, name: '  tuition  ' }, 'u1', 's1');

    expect(mockPrisma.label.create.mock.calls[0][0].data).toMatchObject({
      name: 'tuition',
      category: 'fee',
    });
  });

  it("surfaces the database's case-insensitive rejection as a 409", async () => {
    const svc = await makeService();
    // 'tuition' vs an existing 'Tuition': same key under lower(name).
    mockPrisma.label.create.mockRejectedValue(uniqueViolation());

    await expect(
      svc.create({ category: LabelCategory.fee, name: 'tuition' }, 'u1', 's1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('maps the same violation on rename, using the existing row category', async () => {
    const svc = await makeService();
    mockPrisma.label.findFirst.mockResolvedValue({
      id: 'l1', schoolId: 's1', category: 'income', name: 'Donations', description: null,
    });
    mockPrisma.label.update.mockRejectedValue(uniqueViolation());

    await expect(svc.update('l1', { name: 'transport' }, 'u1', 's1')).rejects.toThrow(
      new ConflictException(
        "A income label named 'transport' already exists in this school",
      ),
    );
  });
});

describe('Label — archive and restore', () => {
  it('archive sets isActive false', async () => {
    const svc = await makeService();
    mockPrisma.label.findFirst.mockResolvedValue({ id: 'l1', schoolId: 's1', isActive: true });
    mockPrisma.label.update.mockResolvedValue({ id: 'l1', isActive: false });

    await svc.archive('l1', 'u1', 's1');
    expect(mockPrisma.label.update.mock.calls[0][0].data).toMatchObject({ isActive: false });
  });

  it('restore rejects a label that is not archived', async () => {
    const svc = await makeService();
    mockPrisma.label.findFirst.mockResolvedValue({ id: 'l1', schoolId: 's1', isActive: true });

    await expect(svc.restore('l1', 'u1', 's1')).rejects.toThrow(
      new ConflictException('Label is not archived'),
    );
  });

  it('category is not writable through update', async () => {
    const svc = await makeService();
    mockPrisma.label.findFirst.mockResolvedValue({
      id: 'l1', schoolId: 's1', category: 'fee', name: 'Tuition', description: null,
    });
    mockPrisma.label.update.mockResolvedValue({ id: 'l1' });

    // UpdateLabelDto has no `category`; even if one is smuggled past the DTO,
    // the service never copies it into the update payload.
    await svc.update('l1', { name: 'Tuition Fees', category: 'income' } as any, 'u1', 's1');

    expect(mockPrisma.label.update.mock.calls[0][0].data).not.toHaveProperty('category');
  });
});
