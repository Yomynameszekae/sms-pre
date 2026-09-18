import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

/**
 * Unique-violation mapping on user create/update.
 *
 * All three user uniques are RAW SQL, declared nowhere in the Prisma schema,
 * so the natural assumption is that Prisma cannot say which one fired. It can:
 * P2002 `meta.target` carries the COLUMN LIST either way. The targets below
 * are the exact values observed against the live database — if they ever stop
 * matching, these tests fail and the 500 comes back, which is the point.
 */
const TARGETS = {
  email: ['school_id', 'lower(email::text)'],
  phone: ['school_id', 'phone'],
  linkedEntity: ['school_id', 'linked_entity_type', 'linked_entity_id'],
};

function uniqueViolation(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.14.0',
    meta: { target },
  });
}

const mockPrisma: any = {
  user: { create: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
};
const mockAuditLogs = { create: jest.fn() };

async function makeService(): Promise<UsersService> {
  const module = await Test.createTestingModule({
    providers: [
      UsersService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: AuditLogsService, useValue: mockAuditLogs },
    ],
  }).compile();
  return module.get(UsersService);
}

const dto = {
  email: 'kwame@example.com',
  password: 'Password123!',
  linkedEntityType: 'staff' as any,
  linkedEntityId: 'staff-1',
};

beforeEach(() => jest.clearAllMocks());

describe('UsersService.create — unique violations become 409, not 500', () => {
  it('names the linked entity when that staff member already has an account', async () => {
    const svc = await makeService();
    mockPrisma.user.create.mockRejectedValue(uniqueViolation(TARGETS.linkedEntity));

    await expect(svc.create(dto, 'actor', 's1')).rejects.toThrow(
      new ConflictException(
        'This staff member already has a user account. Each staff member may only have one login.',
      ),
    );
  });

  it('says "guardian" when the linked entity is a guardian', async () => {
    const svc = await makeService();
    mockPrisma.user.create.mockRejectedValue(uniqueViolation(TARGETS.linkedEntity));

    await expect(
      svc.create({ ...dto, linkedEntityType: 'guardian' as any }, 'actor', 's1'),
    ).rejects.toThrow(/This guardian already has a user account/);
  });

  it('names the email, and says the match is case-insensitive', async () => {
    const svc = await makeService();
    mockPrisma.user.create.mockRejectedValue(uniqueViolation(TARGETS.email));

    await expect(svc.create(dto, 'actor', 's1')).rejects.toThrow(
      /email address already exists in this school \(email is matched case-insensitively\)/,
    );
  });

  it('names the phone number', async () => {
    const svc = await makeService();
    mockPrisma.user.create.mockRejectedValue(uniqueViolation(TARGETS.phone));

    await expect(svc.create(dto, 'actor', 's1')).rejects.toThrow(
      /phone number already exists in this school/,
    );
  });

  it('every mapped case is a ConflictException (409), never a bare 500', async () => {
    const svc = await makeService();
    for (const target of Object.values(TARGETS)) {
      mockPrisma.user.create.mockRejectedValue(uniqueViolation(target));
      await expect(svc.create(dto, 'actor', 's1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    }
  });

  it('rethrows anything that is not a unique violation, untouched', async () => {
    const svc = await makeService();
    const boom = new Error('connection reset');
    mockPrisma.user.create.mockRejectedValue(boom);

    // Swallowing an unrelated failure as a 409 would be worse than the 500
    // this change removes.
    await expect(svc.create(dto, 'actor', 's1')).rejects.toBe(boom);
  });

  it('rethrows a P2002 on some other column, untouched', async () => {
    const svc = await makeService();
    const other = uniqueViolation(['school_id', 'something_else']);
    mockPrisma.user.create.mockRejectedValue(other);

    await expect(svc.create(dto, 'actor', 's1')).rejects.toBe(other);
  });

  it('does not audit a create that failed', async () => {
    const svc = await makeService();
    mockPrisma.user.create.mockRejectedValue(uniqueViolation(TARGETS.email));

    await expect(svc.create(dto, 'actor', 's1')).rejects.toBeInstanceOf(ConflictException);
    expect(mockAuditLogs.create).not.toHaveBeenCalled();
  });
});

describe('UsersService.update — the same exposure, since email and phone are editable', () => {
  beforeEach(() => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'u1', schoolId: 's1', linkedEntityType: 'guardian', linkedEntityId: 'g1',
    });
  });

  it('maps an email collision on edit', async () => {
    const svc = await makeService();
    mockPrisma.user.update.mockRejectedValue(uniqueViolation(TARGETS.email));

    await expect(
      svc.update('u1', { email: 'taken@example.com' }, 'actor', 's1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('maps a phone collision on edit', async () => {
    const svc = await makeService();
    mockPrisma.user.update.mockRejectedValue(uniqueViolation(TARGETS.phone));

    await expect(
      svc.update('u1', { phone: '0244000000' }, 'actor', 's1'),
    ).rejects.toThrow(/phone number already exists/);
  });

  it('rethrows a non-unique failure on edit', async () => {
    const svc = await makeService();
    const boom = new Error('deadlock detected');
    mockPrisma.user.update.mockRejectedValue(boom);

    await expect(
      svc.update('u1', { email: 'x@example.com' }, 'actor', 's1'),
    ).rejects.toBe(boom);
  });
});
