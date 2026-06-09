import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AdmissionsService } from './admissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

const mockPrisma = {
  admissionApplication: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  student: { findFirst: jest.fn() },
  classroom: { findFirst: jest.fn() },
  academicYear: { findFirst: jest.fn() },
  enrollment: { create: jest.fn() },
  $transaction: jest.fn((ops) => Promise.all(ops)),
};

const mockAuditLogs = { create: jest.fn() };

describe('AdmissionsService', () => {
  let service: AdmissionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdmissionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogsService, useValue: mockAuditLogs },
      ],
    }).compile();
    service = module.get<AdmissionsService>(AdmissionsService);
    jest.clearAllMocks();
  });

  describe('findOne — tenant isolation', () => {
    it('throws NotFoundException when admission belongs to a different school', async () => {
      mockPrisma.admissionApplication.findFirst.mockResolvedValue(null);
      await expect(service.findOne('adm-from-school-b', 'school-a')).rejects.toThrow(NotFoundException);
    });

    it('queries with both id and schoolId', async () => {
      const admission = { id: 'adm1', schoolId: 'school-a', status: 'enquiry' };
      mockPrisma.admissionApplication.findFirst.mockResolvedValue(admission);
      await service.findOne('adm1', 'school-a');
      expect(mockPrisma.admissionApplication.findFirst).toHaveBeenCalledWith({
        where: { id: 'adm1', schoolId: 'school-a' },
      });
    });
  });

  describe('offer — status state machine', () => {
    it('throws BadRequestException when status is not enquiry or application', async () => {
      mockPrisma.admissionApplication.findFirst.mockResolvedValue({
        id: 'adm1', schoolId: 'school-a', status: 'enrolled',
      });
      await expect(
        service.offer('adm1', {}, 'user-1', 'school-a'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when status is rejected', async () => {
      mockPrisma.admissionApplication.findFirst.mockResolvedValue({
        id: 'adm1', schoolId: 'school-a', status: 'rejected',
      });
      await expect(
        service.offer('adm1', {}, 'user-1', 'school-a'),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows offer when status is enquiry', async () => {
      mockPrisma.admissionApplication.findFirst.mockResolvedValue({
        id: 'adm1', schoolId: 'school-a', status: 'enquiry',
      });
      mockPrisma.admissionApplication.update.mockResolvedValue({
        id: 'adm1', status: 'offered', offeredAt: new Date(),
      });

      await service.offer('adm1', {}, 'user-1', 'school-a');

      expect(mockPrisma.admissionApplication.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'offered' }) }),
      );
    });

    it('allows offer when status is application', async () => {
      mockPrisma.admissionApplication.findFirst.mockResolvedValue({
        id: 'adm1', schoolId: 'school-a', status: 'application',
      });
      mockPrisma.admissionApplication.update.mockResolvedValue({
        id: 'adm1', status: 'offered', offeredAt: new Date(),
      });

      await service.offer('adm1', {}, 'user-1', 'school-a');

      expect(mockPrisma.admissionApplication.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'offered' }) }),
      );
    });
  });

  describe('enroll — cross-school validation', () => {
    const baseAdmission = { id: 'adm1', schoolId: 'school-a', status: 'offered', studentId: 'st1' };

    beforeEach(() => {
      mockPrisma.admissionApplication.findFirst.mockResolvedValue(baseAdmission);
    });

    it('throws NotFoundException when student belongs to different school', async () => {
      mockPrisma.student.findFirst.mockResolvedValue(null); // school-b student not found in school-a
      mockPrisma.classroom.findFirst.mockResolvedValue({ id: 'cls1', schoolId: 'school-a' });
      mockPrisma.academicYear.findFirst.mockResolvedValue({ id: 'ay1', schoolId: 'school-a' });

      await expect(
        service.enroll(
          'adm1',
          { studentId: 'st-from-school-b', classroomId: 'cls1', academicYearId: 'ay1', curriculumTrack: 'ABEKA' },
          'user-1',
          'school-a',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when classroom belongs to different school', async () => {
      mockPrisma.student.findFirst.mockResolvedValue({ id: 'st1', schoolId: 'school-a' });
      mockPrisma.classroom.findFirst.mockResolvedValue(null); // different school classroom
      mockPrisma.academicYear.findFirst.mockResolvedValue({ id: 'ay1', schoolId: 'school-a' });

      await expect(
        service.enroll(
          'adm1',
          { studentId: 'st1', classroomId: 'cls-from-school-b', academicYearId: 'ay1', curriculumTrack: 'ABEKA' },
          'user-1',
          'school-a',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when academicYear belongs to different school', async () => {
      mockPrisma.student.findFirst.mockResolvedValue({ id: 'st1', schoolId: 'school-a' });
      mockPrisma.classroom.findFirst.mockResolvedValue({ id: 'cls1', schoolId: 'school-a' });
      mockPrisma.academicYear.findFirst.mockResolvedValue(null); // different school

      await expect(
        service.enroll(
          'adm1',
          { studentId: 'st1', classroomId: 'cls1', academicYearId: 'ay-from-school-b', curriculumTrack: 'ABEKA' },
          'user-1',
          'school-a',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException on P2002 (duplicate active enrollment)', async () => {
      mockPrisma.student.findFirst.mockResolvedValue({ id: 'st1', schoolId: 'school-a' });
      mockPrisma.classroom.findFirst.mockResolvedValue({ id: 'cls1', schoolId: 'school-a' });
      mockPrisma.academicYear.findFirst.mockResolvedValue({ id: 'ay1', schoolId: 'school-a' });

      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '5.0',
        meta: { target: ['student_id', 'academic_year_id'] },
      });
      mockPrisma.enrollment.create.mockRejectedValue(p2002);

      await expect(
        service.enroll(
          'adm1',
          { studentId: 'st1', classroomId: 'cls1', academicYearId: 'ay1', curriculumTrack: 'ABEKA' },
          'user-1',
          'school-a',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('creates enrollment and marks admission as enrolled on success', async () => {
      mockPrisma.student.findFirst.mockResolvedValue({ id: 'st1', schoolId: 'school-a' });
      mockPrisma.classroom.findFirst.mockResolvedValue({ id: 'cls1', schoolId: 'school-a' });
      mockPrisma.academicYear.findFirst.mockResolvedValue({ id: 'ay1', schoolId: 'school-a' });
      mockPrisma.enrollment.create.mockResolvedValue({ id: 'enr1', studentId: 'st1' });
      mockPrisma.admissionApplication.update.mockResolvedValue({
        id: 'adm1', status: 'enrolled', enrolledAt: new Date(),
      });

      const result = await service.enroll(
        'adm1',
        { studentId: 'st1', classroomId: 'cls1', academicYearId: 'ay1', curriculumTrack: 'ABEKA' },
        'user-1',
        'school-a',
      );

      expect(result.enrollment.id).toBe('enr1');
      expect(mockPrisma.admissionApplication.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'enrolled' }),
        }),
      );
      expect(mockAuditLogs.create).toHaveBeenCalledTimes(2);
    });

    it('throws BadRequestException when no studentId in DTO or existing admission', async () => {
      mockPrisma.admissionApplication.findFirst.mockResolvedValue({
        id: 'adm1', schoolId: 'school-a', status: 'offered', studentId: null,
      });
      mockPrisma.classroom.findFirst.mockResolvedValue({ id: 'cls1', schoolId: 'school-a' });
      mockPrisma.academicYear.findFirst.mockResolvedValue({ id: 'ay1', schoolId: 'school-a' });

      await expect(
        service.enroll(
          'adm1',
          { classroomId: 'cls1', academicYearId: 'ay1', curriculumTrack: 'ABEKA' } as any,
          'user-1',
          'school-a',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll — tenant isolation', () => {
    it('always filters by schoolId', async () => {
      mockPrisma.admissionApplication.findMany.mockResolvedValue([]);
      mockPrisma.admissionApplication.count.mockResolvedValue(0);
      mockPrisma.$transaction.mockImplementation(async (ops) => Promise.all(ops));

      await service.findAll('school-a', { page: 1, limit: 20 });

      const call = mockPrisma.admissionApplication.findMany.mock.calls[0][0];
      expect(call.where.schoolId).toBe('school-a');
    });
  });
});
