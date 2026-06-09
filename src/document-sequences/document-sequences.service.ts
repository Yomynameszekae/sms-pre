import { Injectable, NotFoundException } from '@nestjs/common';
import { DocumentSequenceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { UpdateSequenceDto } from './dto/update-sequence.dto';

@Injectable()
export class DocumentSequencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(schoolId: string) {
    return this.prisma.documentSequence.findMany({
      where: { schoolId },
      orderBy: { type: 'asc' },
    });
  }

  async findByType(schoolId: string, type: DocumentSequenceType) {
    const sequence = await this.prisma.documentSequence.findUnique({
      where: { schoolId_type: { schoolId, type } },
    });

    if (!sequence) {
      throw new NotFoundException(`Document sequence for type '${type}' not found`);
    }

    return sequence;
  }

  async generateNext(
    schoolId: string,
    type: DocumentSequenceType,
    userId?: string,
    requestId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.documentSequence.update({
        where: { schoolId_type: { schoolId, type } },
        data: { currentNumber: { increment: 1 } },
      });

      const padded = String(updated.currentNumber).padStart(updated.paddingLength, '0');
      const formatted = updated.prefix ? `${updated.prefix}-${padded}` : padded;

      await this.auditLogs.create({
        schoolId,
        userId,
        requestId,
        action: 'document_sequences.generated',
        module: 'document_sequences',
        entityType: 'document_sequence',
        entityId: updated.id,
        metadata: { type, formatted, currentNumber: updated.currentNumber },
      });

      return { sequence: updated, formatted };
    });
  }

  async update(
    schoolId: string,
    type: DocumentSequenceType,
    dto: UpdateSequenceDto,
    userId: string,
    requestId?: string,
  ) {
    const existing = await this.findByType(schoolId, type);

    const updated = await this.prisma.documentSequence.update({
      where: { schoolId_type: { schoolId, type } },
      data: {
        ...(dto.prefix !== undefined && { prefix: dto.prefix }),
        ...(dto.paddingLength !== undefined && { paddingLength: dto.paddingLength }),
        ...(dto.resetPolicy !== undefined && { resetPolicy: dto.resetPolicy }),
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'document_sequences.updated',
      module: 'document_sequences',
      entityType: 'document_sequence',
      entityId: updated.id,
      changes: {
        before: {
          prefix: existing.prefix,
          paddingLength: existing.paddingLength,
          resetPolicy: existing.resetPolicy,
        },
        after: dto,
      },
    });

    return updated;
  }
}
