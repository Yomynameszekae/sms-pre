import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AcademicYearsService } from './academic-years.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

const mockPrisma = {
  academicYear: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
};

const mockAuditLogs = { create: jest.fn() };

describe('AcademicYearsService', () => {
  let service: AcademicYearsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AcademicYearsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogsService, useValue: mockAuditLogs },
      ],
    }).compile();
    service = module.get<AcademicYearsService>(AcademicYearsService);
    jest.clearAllMocks();
  });

  describe('findOne — tenant isolation', () => {
    it('throws NotFoundException when academic year belongs to different school', async () => {
      mockPrisma.academicYear.findFirst.mockResolvedValue(null);
      await expect(service.findOne('ay-from-school-b', 'school-a')).rejects.toThrow(NotFoundException);
    });

    it('always queries with schoolId filter', async () => {
      mockPrisma.academicYear.findFirst.mockResolvedValue({ id: 'ay1', schoolId: 'school-a' });
      await service.findOne('ay1', 'school-a');
      expect(mockPrisma.academicYear.findFirst).toHaveBeenCalledWith({
        where: { id: 'ay1', schoolId: 'school-a' },
      });
    });
  });

  describe('create', () => {
    it('creates academic year with schoolId from service, not DTO', async () => {
      const dto = { label: '2025/2026', startDate: '2025-09-01', endDate: '2026-07-31' };
      mockPrisma.academicYear.create.mockResolvedValue({ id: 'ay1', schoolId: 'school-a', ...dto });

      await service.create(dto, 'user-1', 'school-a');

      const createCall = mockPrisma.academicYear.create.mock.calls[0][0];
      expect(createCall.data.schoolId).toBe('school-a');
    });

    it('writes audit log on creation', async () => {
      const dto = { label: '2025/2026', startDate: '2025-09-01', endDate: '2026-07-31' };
      mockPrisma.academicYear.create.mockResolvedValue({ id: 'ay1' });

      await service.create(dto, 'user-1', 'school-a');

      expect(mockAuditLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'academic_years.created' }),
      );
    });
  });

  describe('activate — one-active-per-school constraint', () => {
    it('throws ConflictException on P2002 (another year already active)', async () => {
      mockPrisma.academicYear.findFirst.mockResolvedValue({ id: 'ay1', schoolId: 'school-a', isActive: false });

      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '5.0',
        meta: { target: ['school_id'] },
      });
      mockPrisma.academicYear.update.mockRejectedValue(p2002);

      await expect(service.activate('ay1', 'user-1', 'school-a')).rejects.toThrow(ConflictException);
    });

    it('succeeds when no other year is active', async () => {
      mockPrisma.academicYear.findFirst.mockResolvedValue({ id: 'ay1', schoolId: 'school-a', isActive: false });
      mockPrisma.academicYear.update.mockResolvedValue({ id: 'ay1', isActive: true });

      await service.activate('ay1', 'user-1', 'school-a');

      expect(mockPrisma.academicYear.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isActive: true }),
        }),
      );
      expect(mockAuditLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'academic_years.activated' }),
      );
    });
  });

  describe('close', () => {
    it('sets isActive to false and writes audit log', async () => {
      mockPrisma.academicYear.findFirst.mockResolvedValue({ id: 'ay1', schoolId: 'school-a', isActive: true });
      mockPrisma.academicYear.update.mockResolvedValue({ id: 'ay1', isActive: false });

      await service.close('ay1', 'user-1', 'school-a');

      expect(mockPrisma.academicYear.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isActive: false }),
        }),
      );
      expect(mockAuditLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'academic_years.closed' }),
      );
    });
  });

  describe('findAll — tenant isolation', () => {
    it('always filters by schoolId', async () => {
      mockPrisma.academicYear.findMany.mockResolvedValue([]);

      await service.findAll('school-a');

      expect(mockPrisma.academicYear.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { schoolId: 'school-a' },
        }),
      );
    });
  });
});
