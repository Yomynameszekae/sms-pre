import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { FilesService } from './files.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

const mockPrisma = {
  file: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn((ops) => Promise.all(ops)),
};

const mockAuditLogs = { create: jest.fn() };

describe('FilesService', () => {
  let service: FilesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogsService, useValue: mockAuditLogs },
      ],
    }).compile();
    service = module.get<FilesService>(FilesService);
    jest.clearAllMocks();
  });

  describe('create — metadata rules', () => {
    const baseDto = {
      ownerType: 'student' as any,
      ownerId: 'st1',
      originalFileName: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      storageBucket: 'ghana-sms-dev',
      storageKey: 'students/st1/report.pdf',
    };

    it('always sets isPublic = false regardless of any client intent', async () => {
      mockPrisma.file.create.mockResolvedValue({ id: 'f1', isPublic: false, storageKey: baseDto.storageKey });

      await service.create(baseDto, 'user-1', 'school-a');

      const createCall = mockPrisma.file.create.mock.calls[0][0];
      expect(createCall.data.isPublic).toBe(false);
    });

    it('sets schoolId from service parameter, not from DTO', async () => {
      mockPrisma.file.create.mockResolvedValue({ id: 'f1', schoolId: 'school-a' });

      await service.create(baseDto, 'user-1', 'school-a');

      const createCall = mockPrisma.file.create.mock.calls[0][0];
      expect(createCall.data.schoolId).toBe('school-a');
    });

    it('casts sizeBytes to BigInt', async () => {
      mockPrisma.file.create.mockResolvedValue({ id: 'f1' });

      await service.create({ ...baseDto, sizeBytes: 5000 }, 'user-1', 'school-a');

      const createCall = mockPrisma.file.create.mock.calls[0][0];
      expect(createCall.data.sizeBytes).toBe(BigInt(5000));
    });

    it('omits storageKey from audit log metadata', async () => {
      mockPrisma.file.create.mockResolvedValue({ id: 'f1' });

      await service.create(baseDto, 'user-1', 'school-a');

      const auditCall = mockAuditLogs.create.mock.calls[0][0];
      expect(auditCall.changes.after.storageKey).toBeUndefined();
    });

    it('writes audit log with files.created action', async () => {
      mockPrisma.file.create.mockResolvedValue({ id: 'f1' });

      await service.create(baseDto, 'user-1', 'school-a');

      expect(mockAuditLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'files.created' }),
      );
    });
  });

  describe('findOne — tenant isolation', () => {
    it('throws NotFoundException when file belongs to different school', async () => {
      mockPrisma.file.findFirst.mockResolvedValue(null);
      await expect(service.findOne('f-from-school-b', 'school-a')).rejects.toThrow(NotFoundException);
    });

    it('queries with both id and schoolId', async () => {
      mockPrisma.file.findFirst.mockResolvedValue({ id: 'f1', schoolId: 'school-a' });
      await service.findOne('f1', 'school-a');
      expect(mockPrisma.file.findFirst).toHaveBeenCalledWith({
        where: { id: 'f1', schoolId: 'school-a' },
      });
    });
  });

  describe('findAll — tenant isolation', () => {
    it('always filters by schoolId and excludes archived files', async () => {
      mockPrisma.file.findMany.mockResolvedValue([]);
      mockPrisma.file.count.mockResolvedValue(0);
      mockPrisma.$transaction.mockImplementation(async (ops) => Promise.all(ops));

      await service.findAll('school-a', { page: 1, limit: 20 });

      const call = mockPrisma.file.findMany.mock.calls[0][0];
      expect(call.where.schoolId).toBe('school-a');
      expect(call.where.archivedAt).toBeNull();
    });
  });

  describe('archive', () => {
    it('sets archivedAt (does not delete)', async () => {
      mockPrisma.file.findFirst.mockResolvedValue({ id: 'f1', schoolId: 'school-a' });
      mockPrisma.file.update.mockResolvedValue({ id: 'f1', archivedAt: new Date() });

      await service.archive('f1', 'user-1', 'school-a');

      expect(mockPrisma.file.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            archivedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('throws NotFoundException when file not in school', async () => {
      mockPrisma.file.findFirst.mockResolvedValue(null);
      await expect(service.archive('f-missing', 'user-1', 'school-a')).rejects.toThrow(NotFoundException);
    });

    it('writes audit log with files.archived action', async () => {
      mockPrisma.file.findFirst.mockResolvedValue({ id: 'f1', schoolId: 'school-a' });
      mockPrisma.file.update.mockResolvedValue({ id: 'f1', archivedAt: new Date() });

      await service.archive('f1', 'user-1', 'school-a');

      expect(mockAuditLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'files.archived' }),
      );
    });
  });
});
