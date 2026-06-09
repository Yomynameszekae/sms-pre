import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { hashPassword } from '../common/utils/hash.util';
import { getPaginationParams, paginate } from '../common/utils/pagination.util';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private auditLogs: AuditLogsService,
  ) {}

  async create(dto: CreateUserDto, actorUserId: string, schoolId: string, requestId?: string) {
    const passwordHash = await hashPassword(dto.password);

    const user = await this.prisma.user.create({
      data: {
        schoolId,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        passwordHash,
        linkedEntityType: dto.linkedEntityType as any,
        linkedEntityId: dto.linkedEntityId,
        isActive: true,
        mustChangePassword: true,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      },
      select: {
        id: true,
        schoolId: true,
        email: true,
        phone: true,
        linkedEntityType: true,
        linkedEntityId: true,
        isActive: true,
        mustChangePassword: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId: actorUserId,
      requestId,
      actorType: 'user',
      action: 'users.create',
      module: 'users',
      entityType: 'user',
      entityId: user.id,
      changes: { email: dto.email, phone: dto.phone, linkedEntityType: dto.linkedEntityType, linkedEntityId: dto.linkedEntityId },
    });

    return user;
  }

  async findAll(schoolId: string, query: QueryUsersDto) {
    const { skip, take } = getPaginationParams(query.page, query.limit);

    const where: any = { schoolId };
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.linkedEntityType) where.linkedEntityType = query.linkedEntityType;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          schoolId: true,
          email: true,
          phone: true,
          linkedEntityType: true,
          linkedEntityId: true,
          isActive: true,
          mustChangePassword: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
          roles: {
            select: {
              id: true,
              grantedAt: true,
              role: {
                select: { id: true, name: true, code: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.user.count({ where }),
    ]);

    return paginate(items, total, query.page ?? 1, query.limit ?? 20);
  }

  async findOne(id: string, schoolId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, schoolId },
      select: {
        id: true,
        schoolId: true,
        email: true,
        phone: true,
        linkedEntityType: true,
        linkedEntityId: true,
        isActive: true,
        mustChangePassword: true,
        lastLoginAt: true,
        passwordChangedAt: true,
        createdAt: true,
        updatedAt: true,
        createdBy: true,
        updatedBy: true,
        roles: {
          select: {
            id: true,
            grantedAt: true,
            grantedBy: true,
            role: {
              select: {
                id: true,
                name: true,
                code: true,
                description: true,
                isSystemRole: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }

    return user;
  }

  async update(id: string, dto: UpdateUserDto, actorUserId: string, schoolId: string, requestId?: string) {
    await this.findOne(id, schoolId);

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        updatedBy: actorUserId,
      },
      select: {
        id: true,
        schoolId: true,
        email: true,
        phone: true,
        linkedEntityType: true,
        linkedEntityId: true,
        isActive: true,
        mustChangePassword: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId: actorUserId,
      requestId,
      actorType: 'user',
      action: 'users.update',
      module: 'users',
      entityType: 'user',
      entityId: id,
      changes: dto as Record<string, any>,
    });

    return updated;
  }

  async deactivate(id: string, actorUserId: string, schoolId: string, requestId?: string) {
    await this.findOne(id, schoolId);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { isActive: false, updatedBy: actorUserId },
      }),
      this.prisma.userSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'user_deactivated' },
      }),
    ]);

    await this.auditLogs.create({
      schoolId,
      userId: actorUserId,
      requestId,
      actorType: 'user',
      action: 'users.deactivated',
      module: 'users',
      entityType: 'user',
      entityId: id,
    });

    return { id, isActive: false };
  }

  async assignRole(
    userId: string,
    roleId: string,
    actorUserId: string,
    schoolId: string,
    requestId?: string,
  ) {
    await this.findOne(userId, schoolId);

    // Verify role exists: system role (schoolId=null) OR school role with same schoolId
    const role = await this.prisma.role.findFirst({
      where: {
        id: roleId,
        OR: [{ schoolId: null }, { schoolId }],
        isActive: true,
      },
    });

    if (!role) {
      throw new BadRequestException(`Role ${roleId} not found or not accessible for this school`);
    }

    const userRole = await this.prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId } },
      create: {
        userId,
        roleId,
        grantedBy: actorUserId,
      },
      update: {
        grantedBy: actorUserId,
        grantedAt: new Date(),
      },
      select: {
        id: true,
        userId: true,
        roleId: true,
        grantedBy: true,
        grantedAt: true,
        role: { select: { id: true, name: true, code: true } },
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId: actorUserId,
      requestId,
      actorType: 'user',
      action: 'users.role_assigned',
      module: 'users',
      entityType: 'user',
      entityId: userId,
      changes: { roleId, roleName: role.name },
    });

    return userRole;
  }

  async removeRole(
    userId: string,
    roleId: string,
    actorUserId: string,
    schoolId: string,
    requestId?: string,
  ) {
    await this.findOne(userId, schoolId);

    const existing = await this.prisma.userRole.findUnique({
      where: { userId_roleId: { userId, roleId } },
    });

    if (!existing) {
      throw new NotFoundException(`Role ${roleId} is not assigned to user ${userId}`);
    }

    await this.prisma.userRole.delete({
      where: { userId_roleId: { userId, roleId } },
    });

    await this.auditLogs.create({
      schoolId,
      userId: actorUserId,
      requestId,
      actorType: 'user',
      action: 'users.role_removed',
      module: 'users',
      entityType: 'user',
      entityId: userId,
      changes: { roleId },
    });

    return { userId, roleId, removed: true };
  }
}
