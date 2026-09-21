import { Test } from '@nestjs/testing';
import { GuardiansService } from './guardians.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

/**
 * Guardian search, which the notification log's guardian picker and the
 * student-guardian link both drive.
 *
 * A name spans two columns, so the interesting case is the one a user is most
 * likely to type — the whole name — which no single `contains` can match.
 */
const mockPrisma: any = {
  guardian: { findMany: jest.fn(), count: jest.fn() },
  $transaction: jest.fn((arg: any) =>
    typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg)),
};
const mockAuditLogs = { create: jest.fn() };

async function makeService(): Promise<GuardiansService> {
  const module = await Test.createTestingModule({
    providers: [
      GuardiansService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: AuditLogsService, useValue: mockAuditLogs },
    ],
  }).compile();
  return module.get(GuardiansService);
}

/** The `where` the service handed to Prisma. */
const whereUsed = () => mockPrisma.guardian.findMany.mock.calls[0][0].where;

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.guardian.findMany.mockResolvedValue([]);
  mockPrisma.guardian.count.mockResolvedValue(0);
});

/** Does this `where` select the given guardian? Mirrors Prisma's semantics. */
function matches(where: any, g: { firstName: string; lastName: string }): boolean {
  const clause = (c: any): boolean => {
    if (c.OR) return c.OR.some(clause);
    if (c.AND) return c.AND.every(clause);
    if (c.firstName?.contains !== undefined) {
      return g.firstName.toLowerCase().includes(String(c.firstName.contains).toLowerCase());
    }
    if (c.lastName?.contains !== undefined) {
      return g.lastName.toLowerCase().includes(String(c.lastName.contains).toLowerCase());
    }
    return true;
  };
  return where.OR ? where.OR.some(clause) : true;
}

const SAMUEL = { firstName: 'Samuel', lastName: 'Boakye' };
const GEORGINA = { firstName: 'Georgina', lastName: 'Boakye' };
const AKUA = { firstName: 'Akua', lastName: 'Mensah' };

describe('guardian search', () => {
  it('matches a first name on its own, as it always did', async () => {
    const svc = await makeService();
    await svc.findAll('s1', { search: 'Samuel' } as any);

    const where = whereUsed();
    expect(matches(where, SAMUEL)).toBe(true);
    expect(matches(where, AKUA)).toBe(false);
  });

  it('matches a last name on its own, as it always did', async () => {
    const svc = await makeService();
    await svc.findAll('s1', { search: 'Boakye' } as any);

    const where = whereUsed();
    expect(matches(where, SAMUEL)).toBe(true);
    expect(matches(where, GEORGINA)).toBe(true);
    expect(matches(where, AKUA)).toBe(false);
  });

  it('matches a FULL name, which previously returned nothing', async () => {
    // "Samuel Boakye" is a substring of neither column, so the old two-clause
    // OR could not match it however the name was spelled.
    const svc = await makeService();
    await svc.findAll('s1', { search: 'Samuel Boakye' } as any);

    const where = whereUsed();
    expect(matches(where, SAMUEL)).toBe(true);
    expect(matches(where, GEORGINA)).toBe(false);
    expect(matches(where, AKUA)).toBe(false);
  });

  it('matches a full name written the other way round', async () => {
    const svc = await makeService();
    await svc.findAll('s1', { search: 'Boakye Samuel' } as any);

    expect(matches(whereUsed(), SAMUEL)).toBe(true);
  });

  it('is case-insensitive throughout, single word and full name', async () => {
    const svc = await makeService();
    await svc.findAll('s1', { search: 'sAmUeL bOaKyE' } as any);

    expect(matches(whereUsed(), SAMUEL)).toBe(true);
  });

  it('tolerates extra whitespace between the words', async () => {
    const svc = await makeService();
    await svc.findAll('s1', { search: '  Samuel   Boakye  ' } as any);

    expect(matches(whereUsed(), SAMUEL)).toBe(true);
  });

  it('applies no name filter when the search is blank', async () => {
    const svc = await makeService();
    await svc.findAll('s1', { search: '   ' } as any);

    expect(whereUsed().OR).toBeUndefined();
  });

  it('still scopes to the school and hides archived guardians by default', async () => {
    const svc = await makeService();
    await svc.findAll('s1', { search: 'Samuel Boakye' } as any);

    const where = whereUsed();
    expect(where.schoolId).toBe('s1');
    expect(where.archivedAt).toBeNull();
  });
});
