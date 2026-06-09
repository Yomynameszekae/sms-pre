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
  $transaction: jest.fn(),
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
});
