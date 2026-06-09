import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogsService } from './audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  auditLog: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
  },
  $transaction: jest.fn((ops) => Promise.all(ops)),
};

describe('AuditLogsService', () => {
  let service: AuditLogsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<AuditLogsService>(AuditLogsService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('creates an audit log with the given data', async () => {
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'log1' });

      await service.create({
        schoolId: 's1',
        userId: 'u1',
        action: 'students.created',
        module: 'students',
        entityType: 'student',
        entityId: 'st1',
        actorType: 'user',
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'students.created',
            module: 'students',
            entityType: 'student',
          }),
        }),
      );
    });

    it('works without optional fields', async () => {
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'log2' });
      await service.create({ action: 'seed.completed', actorType: 'seed' });
      expect(mockPrisma.auditLog.create).toHaveBeenCalled();
    });
  });

  describe('findAll (tenant isolation)', () => {
    it('always filters by schoolId', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);
      mockPrisma.$transaction.mockImplementation(async (ops) => Promise.all(ops));

      await service.findAll('school-a', { page: 1, limit: 20 });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ schoolId: 'school-a' }),
        }),
      );
    });

    it('uses the provided schoolId not any other school', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);
      mockPrisma.$transaction.mockImplementation(async (ops) => Promise.all(ops));

      await service.findAll('school-b', { page: 1, limit: 20 });

      const call = mockPrisma.auditLog.findMany.mock.calls[0][0];
      expect(call.where.schoolId).toBe('school-b');
      expect(call.where.schoolId).not.toBe('school-a');
    });
  });

  describe('findOne (tenant isolation)', () => {
    it('queries with both id and schoolId', async () => {
      mockPrisma.auditLog.findFirst.mockResolvedValue(null);

      await service.findOne('log1', 'school-a');

      expect(mockPrisma.auditLog.findFirst).toHaveBeenCalledWith({
        where: { id: 'log1', schoolId: 'school-a' },
      });
    });
  });

  describe('immutability', () => {
    it('service exposes no update or delete methods', () => {
      expect((service as any).update).toBeUndefined();
      expect((service as any).remove).toBeUndefined();
      expect((service as any).delete).toBeUndefined();
    });
  });
});
