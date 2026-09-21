import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StaffService } from './staff.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

const mockPrisma = {
  staff: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  // Dual-form $transaction: interactive callbacks receive this mock as tx.
  $transaction: jest.fn((arg) =>
    typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg)),
  documentSequence: { update: jest.fn() },
};

const mockAuditLogs = { create: jest.fn() };

function makeP2002(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint', {
    code: 'P2002',
    clientVersion: '5.0',
    meta: { target },
  });
}

describe('StaffService', () => {
  let service: StaffService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaffService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogsService, useValue: mockAuditLogs },
      ],
    }).compile();
    service = module.get<StaffService>(StaffService);
    jest.clearAllMocks();
  });

  const baseDto = {
    staffNumber: 'STF-001',
    firstName: 'Ama',
    lastName: 'Owusu',
    roleCategory: 'teacher' as const,
    ntcStatus: 'licensed' as const,
  };

  describe('create — P2002 field-specific messages', () => {
    it('reports staff number conflict when target includes staff_number', async () => {
      mockPrisma.staff.create.mockRejectedValue(makeP2002(['school_id', 'staff_number']));

      await expect(service.create(baseDto, 'user-1', 'school-a')).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining('staff number'),
        }),
      );
    });

    it('reports phone conflict when target includes phone', async () => {
      mockPrisma.staff.create.mockRejectedValue(makeP2002(['school_id', 'phone']));

      await expect(service.create(baseDto, 'user-1', 'school-a')).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining('phone number'),
        }),
      );
    });

    it('reports email conflict when target includes email', async () => {
      mockPrisma.staff.create.mockRejectedValue(makeP2002(['school_id', 'email']));

      await expect(service.create(baseDto, 'user-1', 'school-a')).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining('email address'),
        }),
      );
    });

    it('throws ConflictException on any P2002', async () => {
      mockPrisma.staff.create.mockRejectedValue(makeP2002(['school_id', 'staff_number']));

      await expect(service.create(baseDto, 'user-1', 'school-a')).rejects.toThrow(
        ConflictException,
      );
    });

    it('writes audit log and returns staff on success', async () => {
      const created = { id: 'staff-1', ...baseDto };
      mockPrisma.staff.create.mockResolvedValue(created);

      const result = await service.create(baseDto, 'user-1', 'school-a');

      expect(result).toEqual(created);
      expect(mockAuditLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'staff.created', entityId: 'staff-1' }),
      );
    });
  });

  describe('findOne — tenant isolation', () => {
    it('throws NotFoundException when staff belongs to a different school', async () => {
      mockPrisma.staff.findFirst.mockResolvedValue(null);

      await expect(service.findOne('staff-b', 'school-a')).rejects.toThrow(NotFoundException);
    });

    it('always queries with both id and schoolId', async () => {
      mockPrisma.staff.findFirst.mockResolvedValue({ id: 'staff-1', schoolId: 'school-a' });

      await service.findOne('staff-1', 'school-a');

      expect(mockPrisma.staff.findFirst).toHaveBeenCalledWith({
        where: { id: 'staff-1', schoolId: 'school-a' },
      });
    });
  });

  describe('archive', () => {
    it('sets status to terminated and stamps archivedAt', async () => {
      mockPrisma.staff.findFirst.mockResolvedValue({ id: 'staff-1', schoolId: 'school-a' });
      mockPrisma.staff.update.mockResolvedValue({ id: 'staff-1' });

      await service.archive('staff-1', 'user-1', 'school-a');

      expect(mockPrisma.staff.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'terminated' }),
        }),
      );
      expect(mockAuditLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'staff.archived' }),
      );
    });
  });

  // ── search ────────────────────────────────────────────────────────────────
  //
  // A staff name spans two columns, so the query a user is most likely to
  // type — the whole name — is the one no single `contains` can match.
  describe('findAll — search', () => {
    /** The `where` handed to Prisma. */
    const whereUsed = () => (mockPrisma.staff.findMany as jest.Mock).mock.calls[0][0].where;

    /** Does this `where` select the given person? Mirrors Prisma's semantics. */
    function matches(
      where: any,
      p: { firstName: string; lastName: string; staffNumber: string },
    ): boolean {
      const clause = (c: any): boolean => {
        if (c.OR) return c.OR.some(clause);
        if (c.AND) return c.AND.every(clause);
        for (const field of ['firstName', 'lastName', 'staffNumber'] as const) {
          if (c[field]?.contains !== undefined) {
            return p[field].toLowerCase().includes(String(c[field].contains).toLowerCase());
          }
        }
        return true;
      };
      return where.OR ? where.OR.some(clause) : true;
    }

    const YAW = { firstName: 'Yaw', lastName: 'Darko', staffNumber: 'STF-0003' };
    // Shares a first name with one person and a last name with another, so a
    // careless OR would match all three on a full-name query.
    const YAW_MENSAH = { firstName: 'Yaw', lastName: 'Mensah', staffNumber: 'STF-0010' };
    const KOFI_DARKO = { firstName: 'Kofi', lastName: 'Darko', staffNumber: 'STF-0011' };

    beforeEach(() => {
      (mockPrisma.staff.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.staff.count as jest.Mock).mockResolvedValue(0);
    });

    it('matches a single first name, as it always did', async () => {
      await service.findAll('school-a', { search: 'Yaw' } as any);
      const where = whereUsed();
      expect(matches(where, YAW)).toBe(true);
      expect(matches(where, KOFI_DARKO)).toBe(false);
    });

    it('matches a single last name, as it always did', async () => {
      await service.findAll('school-a', { search: 'Darko' } as any);
      const where = whereUsed();
      expect(matches(where, YAW)).toBe(true);
      expect(matches(where, KOFI_DARKO)).toBe(true);
      expect(matches(where, YAW_MENSAH)).toBe(false);
    });

    it('still matches the staff number', async () => {
      await service.findAll('school-a', { search: 'STF-0003' } as any);
      const where = whereUsed();
      expect(matches(where, YAW)).toBe(true);
      expect(matches(where, KOFI_DARKO)).toBe(false);
    });

    it('matches a FULL name, which previously returned nothing', async () => {
      await service.findAll('school-a', { search: 'Yaw Darko' } as any);
      expect(matches(whereUsed(), YAW)).toBe(true);
    });

    it('does NOT cross-match two different people who share half a name', async () => {
      // Yaw Mensah and Kofi Darko between them contain both words, but neither
      // is Yaw Darko.
      await service.findAll('school-a', { search: 'Yaw Darko' } as any);
      const where = whereUsed();
      expect(matches(where, YAW_MENSAH)).toBe(false);
      expect(matches(where, KOFI_DARKO)).toBe(false);
    });

    it('matches a full name written the other way round', async () => {
      await service.findAll('school-a', { search: 'Darko Yaw' } as any);
      expect(matches(whereUsed(), YAW)).toBe(true);
    });

    it('is case-insensitive for a full name', async () => {
      await service.findAll('school-a', { search: 'yAw dArKo' } as any);
      expect(matches(whereUsed(), YAW)).toBe(true);
    });

    it('does not pair a name with an unrelated staff number', async () => {
      // The token clause omits staffNumber on purpose: "Yaw STF-0011" must not
      // match Yaw Darko by taking the name from one field and the number from
      // a different person's row.
      await service.findAll('school-a', { search: 'Yaw STF-0011' } as any);
      expect(matches(whereUsed(), YAW)).toBe(false);
    });

    it('applies no filter for a blank search', async () => {
      await service.findAll('school-a', { search: '   ' } as any);
      expect(whereUsed().OR).toBeUndefined();
    });
  });

});
