import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { StudentGuardiansService } from './student-guardians.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Prisma } from '@prisma/client';

const mockPrisma = {
  student: { findFirst: jest.fn() },
  guardian: { findFirst: jest.fn() },
  studentGuardian: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

const mockAuditLogs = { create: jest.fn() };

describe('StudentGuardiansService', () => {
  let service: StudentGuardiansService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudentGuardiansService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogsService, useValue: mockAuditLogs },
      ],
    }).compile();
    service = module.get<StudentGuardiansService>(StudentGuardiansService);
    jest.clearAllMocks();
  });

  describe('link — cross-school validation', () => {
    it('throws BadRequestException when student belongs to different school', async () => {
      // Student exists but belongs to school-b, not school-a
      mockPrisma.student.findFirst.mockResolvedValue({ id: 'st-from-school-b', schoolId: 'school-b' });
      await expect(
        service.link(
          { studentId: 'st-from-school-b', guardianId: 'g1', isPrimary: false },
          'user-1',
          'school-a',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when guardian belongs to different school', async () => {
      mockPrisma.student.findFirst.mockResolvedValue({ id: 'st1', schoolId: 'school-a' });
      // Guardian exists but belongs to school-b
      mockPrisma.guardian.findFirst.mockResolvedValue({ id: 'g-from-school-b', schoolId: 'school-b' });
      await expect(
        service.link(
          { studentId: 'st1', guardianId: 'g-from-school-b', isPrimary: false },
          'user-1',
          'school-a',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates link when both belong to same school', async () => {
      mockPrisma.student.findFirst.mockResolvedValue({ id: 'st1', schoolId: 'school-a' });
      mockPrisma.guardian.findFirst.mockResolvedValue({ id: 'g1', schoolId: 'school-a' });
      mockPrisma.studentGuardian.create.mockResolvedValue({ id: 'sg1' });

      await service.link({ studentId: 'st1', guardianId: 'g1' }, 'user-1', 'school-a');

      expect(mockPrisma.studentGuardian.create).toHaveBeenCalled();
      expect(mockAuditLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'student_guardians.linked' }),
      );
    });

    it('throws ConflictException when student already has a primary guardian and linking another primary', async () => {
      mockPrisma.student.findFirst.mockResolvedValue({ id: 'st1', schoolId: 'school-a' });
      mockPrisma.guardian.findFirst.mockResolvedValue({ id: 'g2', schoolId: 'school-a' });

      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '5.0',
        meta: { target: ['student_id'] },
      });
      mockPrisma.studentGuardian.create.mockRejectedValue(p2002);

      await expect(
        service.link({ studentId: 'st1', guardianId: 'g2', isPrimary: true }, 'user-1', 'school-a'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('unlink', () => {
    it('throws NotFoundException when relationship not found in school', async () => {
      mockPrisma.studentGuardian.findFirst.mockResolvedValue(null);
      await expect(service.unlink('sg-missing', 'user-1', 'school-a')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deletes the relationship', async () => {
      mockPrisma.studentGuardian.findFirst.mockResolvedValue({ id: 'sg1', schoolId: 'school-a' });
      mockPrisma.studentGuardian.delete.mockResolvedValue({ id: 'sg1' });

      await service.unlink('sg1', 'user-1', 'school-a');

      expect(mockPrisma.studentGuardian.delete).toHaveBeenCalledWith({ where: { id: 'sg1' } });
    });
  });
});
