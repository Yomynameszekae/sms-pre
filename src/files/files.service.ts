import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateFileDto } from './dto/create-file.dto';
import { QueryFilesDto } from './dto/query-files.dto';
import { getPaginationParams, paginate } from '../common/utils/pagination.util';
import { FileOwnerType } from '@prisma/client';

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  private serialize<T extends { sizeBytes: bigint }>(file: T): Omit<T, 'sizeBytes'> & { sizeBytes: number } {
    return { ...file, sizeBytes: Number(file.sizeBytes) };
  }

  async create(
    dto: CreateFileDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    const file = await this.prisma.file.create({
      data: {
        schoolId,
        ownerType: dto.ownerType,
        ownerId: dto.ownerId ?? null,
        category: dto.category ?? null,
        originalFileName: dto.originalFileName,
        storedFileName: dto.storedFileName ?? null,
        mimeType: dto.mimeType,
        // sizeBytes is BigInt in DB; cast from Number DTO value
        sizeBytes: BigInt(dto.sizeBytes),
        storageBucket: dto.storageBucket,
        storageKey: dto.storageKey,
        checksumSha256: dto.checksumSha256 ?? null,
        // Files are private by default — never expose raw storage paths as public URLs
        isPublic: false,
        uploadedBy: userId,
        createdBy: userId,
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'files.created',
      module: 'files',
      entityType: 'file',
      entityId: file.id,
      changes: {
        after: {
          ownerType: dto.ownerType,
          ownerId: dto.ownerId,
          category: dto.category,
          originalFileName: dto.originalFileName,
          mimeType: dto.mimeType,
          sizeBytes: dto.sizeBytes,
          // storageKey intentionally omitted from audit metadata — not a public URL
        },
      },
    });

    return this.serialize(file);
  }

  async findAll(schoolId: string, query: QueryFilesDto) {
    const { skip, take } = getPaginationParams(query.page, query.limit);

    const where: Prisma.FileWhereInput = { schoolId, archivedAt: null };
    if (query.ownerType) where.ownerType = query.ownerType;
    if (query.ownerId) where.ownerId = query.ownerId;
    if (query.category) where.category = query.category;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.file.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.file.count({ where }),
    ]);

    return paginate(items.map((f) => this.serialize(f)), total, query.page ?? 1, query.limit ?? 20);
  }

  async findOne(id: string, schoolId: string) {
    const file = await this.prisma.file.findFirst({
      where: { id, schoolId },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    return this.serialize(file);
  }

  async findByOwner(schoolId: string, ownerType: FileOwnerType, ownerId: string) {
    const files = await this.prisma.file.findMany({
      where: {
        schoolId,
        ownerType,
        ownerId,
        archivedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    return files.map((f) => this.serialize(f));
  }

  async archive(
    id: string,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    await this.findOne(id, schoolId);

    const file = await this.prisma.file.update({
      where: { id },
      data: {
        archivedAt: new Date(),
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'files.archived',
      module: 'files',
      entityType: 'file',
      entityId: id,
      changes: {
        after: { archivedAt: file.archivedAt },
      },
    });

    return this.serialize(file);
  }
}
