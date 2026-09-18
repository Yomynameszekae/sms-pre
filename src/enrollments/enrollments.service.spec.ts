import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EnrollmentsService } from './enrollments.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

const mockPrisma = {
  enrollment: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  student: { findFirst: jest.fn() },
  classroom: { findFirst: jest.fn() },
  academicYear: { findFirst: jest.fn() },
  $transaction: jest.fn((ops) => Promise.all(ops)),
};

const mockAuditLogs = { create: jest.fn() };

describe('EnrollmentsService', () => {
  let service: EnrollmentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnrollmentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogsService, useValue: mockAuditLogs },
      ],
    }).compile();
    service = module.get<EnrollmentsService>(EnrollmentsService);
    jest.clearAllMocks();
  });

  describe('findOne — tenant isolation', () => {
    it('throws NotFoundException when enrollment belongs to a different school', async () => {
      mockPrisma.enrollment.findFirst.mockResolvedValue(null);
      await expect(service.findOne('enr-from-school-b', 'school-a')).rejects.toThrow(NotFoundException);
    });

    it('queries with both id and schoolId', async () => {
      mockPrisma.enrollment.findFirst.mockResolvedValue({ id: 'enr1', schoolId: 'school-a' });
      await service.findOne('enr1', 'school-a');
      expect(mockPrisma.enrollment.findFirst).toHaveBeenCalledWith({
        where: { id: 'enr1', schoolId: 'school-a' },
      });
    });
  });

  describe('create — cross-school validation', () => {
    it('throws NotFoundException when student belongs to different school', async () => {
      mockPrisma.student.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          { studentId: 'st-b', classroomId: 'cls1', academicYearId: 'ay1', curriculumTrack: 'ABEKA' },
          'user-1',
          'school-a',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when classroom belongs to different school', async () => {
      mockPrisma.student.findFirst.mockResolvedValue({ id: 'st1', schoolId: 'school-a' });
      mockPrisma.classroom.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          { studentId: 'st1', classroomId: 'cls-b', academicYearId: 'ay1', curriculumTrack: 'ABEKA' },
          'user-1',
          'school-a',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when academicYear belongs to different school', async () => {
      mockPrisma.student.findFirst.mockResolvedValue({ id: 'st1', schoolId: 'school-a' });
      mockPrisma.classroom.findFirst.mockResolvedValue({ id: 'cls1', schoolId: 'school-a', academicYearId: 'ay1' });
      mockPrisma.academicYear.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          { studentId: 'st1', classroomId: 'cls1', academicYearId: 'ay-b', curriculumTrack: 'ABEKA' },
          'user-1',
          'school-a',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException on P2002 (duplicate enrollment for same student/year/track)', async () => {
      mockPrisma.student.findFirst.mockResolvedValue({ id: 'st1', schoolId: 'school-a' });
      mockPrisma.classroom.findFirst.mockResolvedValue({ id: 'cls1', schoolId: 'school-a', academicYearId: 'ay1' });
      mockPrisma.academicYear.findFirst.mockResolvedValue({ id: 'ay1', schoolId: 'school-a', label: '2025/2026', endDate: new Date(Date.now() + 90 * 24 * 3600 * 1000) });

      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '5.0',
        meta: { target: ['student_id', 'academic_year_id', 'curriculum_track'] },
      });
      mockPrisma.enrollment.create.mockRejectedValue(p2002);

      await expect(
        service.create(
          { studentId: 'st1', classroomId: 'cls1', academicYearId: 'ay1', curriculumTrack: 'ABEKA' },
          'user-1',
          'school-a',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('creates enrollment with schoolId from service, not DTO', async () => {
      mockPrisma.student.findFirst.mockResolvedValue({ id: 'st1', schoolId: 'school-a' });
      mockPrisma.classroom.findFirst.mockResolvedValue({ id: 'cls1', schoolId: 'school-a', academicYearId: 'ay1' });
      mockPrisma.academicYear.findFirst.mockResolvedValue({ id: 'ay1', schoolId: 'school-a', label: '2025/2026', endDate: new Date(Date.now() + 90 * 24 * 3600 * 1000) });
      mockPrisma.enrollment.create.mockResolvedValue({ id: 'enr1', schoolId: 'school-a' });

      await service.create(
        { studentId: 'st1', classroomId: 'cls1', academicYearId: 'ay1', curriculumTrack: 'ABEKA' },
        'user-1',
        'school-a',
      );

      const createCall = mockPrisma.enrollment.create.mock.calls[0][0];
      expect(createCall.data.schoolId).toBe('school-a');
    });
  });

  describe('create — academic year state', () => {
    const FUTURE = new Date(Date.now() + 200 * 24 * 3600 * 1000);
    const PAST = new Date('2025-08-01');

    beforeEach(() => {
      mockPrisma.student.findFirst.mockResolvedValue({ id: 'st1', schoolId: 'school-a' });
      mockPrisma.classroom.findFirst.mockResolvedValue({ id: 'cls1', schoolId: 'school-a', academicYearId: 'ay1' });
    });

    it('refuses an enrollment into a year that has already ended, naming the date', async () => {
      mockPrisma.academicYear.findFirst.mockResolvedValue({
        id: 'ay1', schoolId: 'school-a', label: '2024/2025', endDate: PAST,
      });
      await expect(
        service.create(
          { studentId: 'st1', classroomId: 'cls1', academicYearId: 'ay1', curriculumTrack: 'ABEKA' },
          'user-1', 'school-a',
        ),
      ).rejects.toThrow('Cannot enroll into 2024/2025: the academic year ended on 2025-08-01.');
      expect(mockPrisma.enrollment.create).not.toHaveBeenCalled();
    });

    it('refuses a classroom that belongs to a different academic year, naming both', async () => {
      mockPrisma.classroom.findFirst.mockResolvedValue({
        id: 'cls1', schoolId: 'school-a', displayName: 'Basic 3A', academicYearId: 'ay-other',
      });
      mockPrisma.academicYear.findFirst
        .mockResolvedValueOnce({ id: 'ay2', schoolId: 'school-a', label: '2026/2027', endDate: FUTURE })
        .mockResolvedValueOnce({ label: '2025/2026' }); // the classroom's actual year
      await expect(
        service.create(
          { studentId: 'st1', classroomId: 'cls1', academicYearId: 'ay2', curriculumTrack: 'ABEKA' },
          'user-1', 'school-a',
        ),
      ).rejects.toThrow(
        "Classroom 'Basic 3A' belongs to the 2025/2026 academic year, not 2026/2027. Pick a classroom from the selected year.",
      );
      expect(mockPrisma.enrollment.create).not.toHaveBeenCalled();
    });

    it('allows pre-enrollment into a future, not-yet-activated year', async () => {
      mockPrisma.classroom.findFirst.mockResolvedValue({
        id: 'cls1', schoolId: 'school-a', displayName: 'Basic 3A', academicYearId: 'ay2',
      });
      mockPrisma.academicYear.findFirst.mockResolvedValue({
        id: 'ay2', schoolId: 'school-a', label: '2026/2027', isActive: false, endDate: FUTURE,
      });
      mockPrisma.enrollment.create.mockResolvedValue({ id: 'enr1' });
      await expect(
        service.create(
          { studentId: 'st1', classroomId: 'cls1', academicYearId: 'ay2', curriculumTrack: 'ABEKA' },
          'user-1', 'school-a',
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('withdraw', () => {
    it('sets status to withdrawn and records exitDate and exitReason', async () => {
      mockPrisma.enrollment.findFirst.mockResolvedValue({
        id: 'enr1', schoolId: 'school-a', status: 'active', exitDate: null, exitReason: null,
      });
      mockPrisma.enrollment.update.mockResolvedValue({
        id: 'enr1', status: 'withdrawn', exitDate: new Date('2026-06-01'), exitReason: 'relocation',
      });

      await service.withdraw(
        'enr1',
        { exitDate: '2026-06-01', exitReason: 'relocation' },
        'user-1',
        'school-a',
      );

      expect(mockPrisma.enrollment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'withdrawn',
            exitReason: 'relocation',
          }),
        }),
      );
      expect(mockAuditLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'enrollments.withdrawn' }),
      );
    });

    it('withdraws with no exit reason — the reason is optional', async () => {
      mockPrisma.enrollment.findFirst.mockResolvedValue({
        id: 'enr1', schoolId: 'school-a', status: 'active', exitDate: null, exitReason: null,
      });
      mockPrisma.enrollment.update.mockResolvedValue({
        id: 'enr1', status: 'withdrawn', exitDate: new Date('2026-06-01'), exitReason: null,
      });

      await service.withdraw('enr1', { exitDate: '2026-06-01' }, 'user-1', 'school-a');

      expect(mockPrisma.enrollment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'withdrawn',
            exitDate: new Date('2026-06-01'),
          }),
        }),
      );
      expect(mockAuditLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'enrollments.withdrawn' }),
      );
    });

    it('throws NotFoundException when enrollment not found in school', async () => {
      mockPrisma.enrollment.findFirst.mockResolvedValue(null);
      await expect(
        service.withdraw('enr-missing', { exitDate: '2026-06-01', exitReason: 'moved' }, 'user-1', 'school-a'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll — tenant isolation', () => {
    it('always filters by schoolId', async () => {
      mockPrisma.enrollment.findMany.mockResolvedValue([]);
      mockPrisma.enrollment.count.mockResolvedValue(0);
      mockPrisma.$transaction.mockImplementation(async (ops) => Promise.all(ops));

      await service.findAll('school-a', { page: 1, limit: 20 });

      const call = mockPrisma.enrollment.findMany.mock.calls[0][0];
      expect(call.where.schoolId).toBe('school-a');
    });
  });
});
