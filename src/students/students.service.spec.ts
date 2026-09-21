import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { StudentsService } from './students.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

const mockPrisma = {
  student: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  studentGuardian: { findMany: jest.fn() },
  enrollment: { findMany: jest.fn() },
  // Supports both $transaction forms: the array form and the interactive
  // callback form (the callback receives this same mock as the tx client).
  $transaction: jest.fn((arg) =>
    typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg)),
  documentSequence: { update: jest.fn() },
};

const mockAuditLogs = { create: jest.fn() };

describe('StudentsService', () => {
  let service: StudentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogsService, useValue: mockAuditLogs },
      ],
    }).compile();
    service = module.get<StudentsService>(StudentsService);
    jest.clearAllMocks();
  });

  describe('findOne — tenant isolation', () => {
    it('throws NotFoundException when student belongs to a different school', async () => {
      mockPrisma.student.findFirst.mockResolvedValue(null);
      await expect(service.findOne('student-from-school-b', 'school-a')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('always queries with schoolId filter', async () => {
      mockPrisma.student.findFirst.mockResolvedValue({ id: 'st1', schoolId: 'school-a' });
      await service.findOne('st1', 'school-a');
      expect(mockPrisma.student.findFirst).toHaveBeenCalledWith({
        where: { id: 'st1', schoolId: 'school-a' },
      });
    });

    it('cannot be fooled by guessing UUID from another school', async () => {
      mockPrisma.student.findFirst.mockResolvedValue(null); // DB returns nothing because schoolId doesn't match
      await expect(service.findOne('guessed-uuid-school-b', 'school-a')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll — tenant isolation', () => {
    it('always filters list by schoolId', async () => {
      mockPrisma.student.findMany.mockResolvedValue([]);
      mockPrisma.student.count.mockResolvedValue(0);
      mockPrisma.$transaction.mockImplementation(async (arg: any) =>
        typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg));

      await service.findAll('school-a', { page: 1, limit: 20 });

      const call = mockPrisma.student.findMany.mock.calls[0][0];
      expect(call.where).toEqual(expect.objectContaining({ schoolId: 'school-a' }));
    });

    it('search matches student number as well as first and last name', async () => {
      mockPrisma.student.findMany.mockResolvedValue([]);
      mockPrisma.student.count.mockResolvedValue(0);
      mockPrisma.$transaction.mockImplementation(async (arg: any) =>
        typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg));

      await service.findAll('school-a', { page: 1, limit: 20, search: 'STU-00' });

      const call = mockPrisma.student.findMany.mock.calls[0][0];
      expect(call.where.OR).toEqual(
        expect.arrayContaining([
          { studentNumber: { contains: 'STU-00', mode: 'insensitive' } },
          { firstName: { contains: 'STU-00', mode: 'insensitive' } },
          { lastName: { contains: 'STU-00', mode: 'insensitive' } },
        ]),
      );
    });

    // ── full-name search ────────────────────────────────────────────────────
    //
    // A child's name spans three columns, so the query a parent or a teacher
    // is most likely to type — the whole name — is the one no single
    // `contains` can match.
    describe('multi-word name search', () => {
      /** The `where` handed to Prisma. */
      const whereUsed = () => mockPrisma.student.findMany.mock.calls[0][0].where;

      /** Does this `where` select the given child? Mirrors Prisma's semantics. */
      function matches(where: any, st: Record<string, string | null>): boolean {
        const clause = (c: any): boolean => {
          if (c.OR) return c.OR.some(clause);
          if (c.AND) return c.AND.every(clause);
          for (const field of ['firstName', 'middleName', 'lastName', 'studentNumber', 'preferredName']) {
            if (c[field]?.contains !== undefined) {
              const value = st[field];
              if (value == null) return false;
              return value.toLowerCase().includes(String(c[field].contains).toLowerCase());
            }
          }
          return true;
        };
        return where.OR ? where.OR.some(clause) : true;
      }

      const AMA = {
        firstName: 'Ama', middleName: 'Serwaa', lastName: 'Boakye',
        studentNumber: 'STU-0001', preferredName: 'Amy',
      };
      // Between them these two contain both words of "Ama Boakye", but
      // neither person IS Ama Boakye.
      const AMA_MENSAH = {
        firstName: 'Ama', middleName: null, lastName: 'Mensah',
        studentNumber: 'STU-0020', preferredName: null,
      };
      const KWABENA_BOAKYE = {
        firstName: 'Kwabena', middleName: null, lastName: 'Boakye',
        studentNumber: 'STU-0021', preferredName: null,
      };

      beforeEach(() => {
        mockPrisma.student.findMany.mockResolvedValue([]);
        mockPrisma.student.count.mockResolvedValue(0);
        mockPrisma.$transaction.mockImplementation(async (arg: any) =>
          typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg));
      });

      it('matches a full first + last name, which previously returned nothing', async () => {
        await service.findAll('school-a', { search: 'Ama Boakye' } as any);
        expect(matches(whereUsed(), AMA)).toBe(true);
      });

      it('does NOT cross-match two children who share half a name', async () => {
        await service.findAll('school-a', { search: 'Ama Boakye' } as any);
        const where = whereUsed();
        expect(matches(where, AMA_MENSAH)).toBe(false);
        expect(matches(where, KWABENA_BOAKYE)).toBe(false);
      });

      it('matches a name written with the middle name, as a register writes it', async () => {
        await service.findAll('school-a', { search: 'Ama Serwaa Boakye' } as any);
        const where = whereUsed();
        expect(matches(where, AMA)).toBe(true);
        // The other two have no middle name, so the Serwaa word matches nothing.
        expect(matches(where, AMA_MENSAH)).toBe(false);
        expect(matches(where, KWABENA_BOAKYE)).toBe(false);
      });

      it('matches a full name written the other way round', async () => {
        await service.findAll('school-a', { search: 'Boakye Ama' } as any);
        expect(matches(whereUsed(), AMA)).toBe(true);
      });

      it('is case-insensitive for a full name', async () => {
        await service.findAll('school-a', { search: 'aMa SeRwAa bOaKyE' } as any);
        expect(matches(whereUsed(), AMA)).toBe(true);
      });

      it('leaves preferredName out of search entirely', async () => {
        // 'Amy' is this child's nickname. Searching it must not find her, and
        // no clause anywhere may name the column.
        await service.findAll('school-a', { search: 'Amy Boakye' } as any);
        const where = whereUsed();
        expect(JSON.stringify(where)).not.toContain('preferredName');
        expect(matches(where, AMA)).toBe(false);
      });

      it('does not pair a name with another child\'s number', async () => {
        await service.findAll('school-a', { search: 'Ama STU-0021' } as any);
        expect(matches(whereUsed(), AMA)).toBe(false);
      });

      it('still matches a single name, as it always did', async () => {
        await service.findAll('school-a', { search: 'Ama' } as any);
        const where = whereUsed();
        expect(matches(where, AMA)).toBe(true);
        expect(matches(where, AMA_MENSAH)).toBe(true);
        expect(matches(where, KWABENA_BOAKYE)).toBe(false);
      });

      it('applies no filter for a blank search', async () => {
        await service.findAll('school-a', { search: '   ' } as any);
        expect(whereUsed().OR).toBeUndefined();
      });
    });
  });

  describe('create', () => {
    it('creates student with schoolId from service (not DTO)', async () => {
      const dto = {
        studentNumber: 'STU-0001',
        firstName: 'Kwame',
        lastName: 'Mensah',
        dateOfBirth: '2015-03-14',
        gender: 'male' as any,
      };
      mockPrisma.student.create.mockResolvedValue({ id: 'st1', ...dto, schoolId: 'school-a' });

      await service.create(dto, 'user-1', 'school-a');

      const createCall = mockPrisma.student.create.mock.calls[0][0];
      expect(createCall.data.schoolId).toBe('school-a');
    });

    it('accepts optional Ghana Card', async () => {
      const dto = {
        studentNumber: 'STU-0002',
        firstName: 'Ama',
        lastName: 'Asante',
        dateOfBirth: '2016-06-01',
        gender: 'female' as any,
        ghanaCardId: undefined, // not required
      };
      mockPrisma.student.create.mockResolvedValue({ id: 'st2', ...dto, schoolId: 'school-a' });
      await expect(service.create(dto, 'user-1', 'school-a')).resolves.toBeDefined();
    });
  });

  describe('archive', () => {
    it('sets archivedAt and status to withdrawn (does not delete)', async () => {
      mockPrisma.student.findFirst.mockResolvedValue({ id: 'st1', schoolId: 'school-a' });
      mockPrisma.student.update.mockResolvedValue({ id: 'st1', archivedAt: new Date() });

      await service.archive('st1', 'user-1', 'school-a');

      expect(mockPrisma.student.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            archivedAt: expect.any(Date),
            status: 'withdrawn',
          }),
        }),
      );
    });
  });
});
