import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DocumentSequencesService } from './document-sequences.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { DocumentSequenceType } from '@prisma/client';

const mockPrisma = {
  documentSequence: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockAuditLogs = { create: jest.fn() };

describe('DocumentSequencesService', () => {
  let service: DocumentSequencesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentSequencesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogsService, useValue: mockAuditLogs },
      ],
    }).compile();
    service = module.get<DocumentSequencesService>(DocumentSequencesService);
    jest.clearAllMocks();
  });

  describe('findByType', () => {
    it('throws NotFoundException when sequence not found', async () => {
      mockPrisma.documentSequence.findFirst.mockResolvedValue(null);
      await expect(
        service.findByType('school-1', DocumentSequenceType.student_number),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('generateNext', () => {
    it('generates a formatted number with prefix and padding', async () => {
      const updatedSeq = {
        id: 'seq1',
        schoolId: 'school-1',
        type: DocumentSequenceType.student_number,
        prefix: 'STU',
        currentNumber: 1,
        paddingLength: 4,
        resetPolicy: 'yearly',
      };

      mockPrisma.$transaction.mockImplementation(async (fn) => {
        const txPrisma = {
          documentSequence: {
            update: jest.fn().mockResolvedValue(updatedSeq),
          },
        };
        return fn(txPrisma);
      });

      const result = await service.generateNext('school-1', DocumentSequenceType.student_number);

      expect(result.formatted).toBe('STU-0001');
      expect(result.sequence.currentNumber).toBe(1);
    });

    it('uses transaction to prevent duplicate numbers', async () => {
      const updatedSeq = {
        id: 'seq1',
        schoolId: 'school-1',
        type: DocumentSequenceType.admission_number,
        prefix: 'ADM',
        currentNumber: 5,
        paddingLength: 4,
        resetPolicy: 'yearly',
      };

      mockPrisma.$transaction.mockImplementation(async (fn) => {
        const txPrisma = {
          documentSequence: { update: jest.fn().mockResolvedValue(updatedSeq) },
        };
        return fn(txPrisma);
      });

      const result = await service.generateNext('school-1', DocumentSequenceType.admission_number);

      // Verify $transaction was used (not direct update)
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(result.formatted).toBe('ADM-0005');
    });

    it('formats without prefix when prefix is null', async () => {
      const updatedSeq = {
        id: 'seq1',
        schoolId: 'school-1',
        type: DocumentSequenceType.student_number,
        prefix: null,
        currentNumber: 3,
        paddingLength: 4,
        resetPolicy: null,
      };

      mockPrisma.$transaction.mockImplementation(async (fn) => {
        const txPrisma = {
          documentSequence: { update: jest.fn().mockResolvedValue(updatedSeq) },
        };
        return fn(txPrisma);
      });

      const result = await service.generateNext('school-1', DocumentSequenceType.student_number);
      expect(result.formatted).toBe('0003');
    });
  });
});
