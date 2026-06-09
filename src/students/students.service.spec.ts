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
  $transaction: jest.fn((ops) => Promise.all(ops)),
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
      mockPrisma.$transaction.mockImplementation(async (ops) => Promise.all(ops));

      await service.findAll('school-a', { page: 1, limit: 20 });

      const call = mockPrisma.student.findMany.mock.calls[0][0];
      expect(call.where).toEqual(expect.objectContaining({ schoolId: 'school-a' }));
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
