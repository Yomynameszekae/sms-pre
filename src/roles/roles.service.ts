import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Injectable()
export class RolesService {
  constructor(
    private prisma: PrismaService,
    private auditLogs: AuditLogsService,
  ) {}

  async create(dto: CreateRoleDto, actorUserId: string, schoolId: string, requestId?: string) {
    const code = dto.code.toUpperCase();

    const role = await this.prisma.role.create({
      data: {
        schoolId,
        name: dto.name,
        code,
        description: dto.description ?? null,
        isSystemRole: false,
        isActive: true,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      },
      select: {
        id: true,
        schoolId: true,
        name: true,
        code: true,
        description: true,
        isSystemRole: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId: actorUserId,
      requestId,
      actorType: 'user',
      action: 'roles.create',
      module: 'roles',
      entityType: 'role',
      entityId: role.id,
      changes: { name: dto.name, code, description: dto.description },
    });

    return role;
  }

  async findAll(schoolId: string) {
    return this.prisma.role.findMany({
      where: {
        OR: [{ schoolId: null, isSystemRole: true }, { schoolId }],
        isActive: true,
      },
      select: {
        id: true,
        schoolId: true,
        name: true,
        code: true,
        description: true,
        isSystemRole: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        permissions: {
          select: {
            id: true,
            permission: {
              select: { id: true, key: true, module: true, description: true },
            },
          },
        },
      },
      orderBy: [{ isSystemRole: 'desc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      select: {
        id: true,
        schoolId: true,
        name: true,
        code: true,
        description: true,
        isSystemRole: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        createdBy: true,
        updatedBy: true,
        permissions: {
          select: {
            id: true,
            permission: {
              select: { id: true, key: true, module: true, description: true },
            },
          },
        },
      },
    });

    if (!role) {
      throw new NotFoundException(`Role ${id} not found`);
    }

    return role;
  }

  async update(id: string, dto: UpdateRoleDto, actorUserId: string, requestId?: string) {
    const role = await this.findOne(id);

    const updated = await this.prisma.role.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.code !== undefined && { code: dto.code.toUpperCase() }),
        updatedBy: actorUserId,
      },
      select: {
        id: true,
        schoolId: true,
        name: true,
        code: true,
        description: true,
        isSystemRole: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.auditLogs.create({
      schoolId: role.schoolId ?? undefined,
      userId: actorUserId,
      requestId,
      actorType: 'user',
      action: 'roles.update',
      module: 'roles',
      entityType: 'role',
      entityId: id,
      changes: dto as Record<string, any>,
    });

    return updated;
  }

  async assignPermission(
    roleId: string,
    permissionId: string,
    actorUserId: string,
    requestId?: string,
  ) {
    const role = await this.findOne(roleId);

    const permission = await this.prisma.permission.findUnique({ where: { id: permissionId } });
    if (!permission) {
      throw new NotFoundException(`Permission ${permissionId} not found`);
    }

    const rolePermission = await this.prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId } },
      create: { roleId, permissionId },
      update: {},
      select: {
        id: true,
        roleId: true,
        permissionId: true,
        createdAt: true,
        permission: { select: { id: true, key: true, module: true } },
      },
    });

    await this.auditLogs.create({
      schoolId: role.schoolId ?? undefined,
      userId: actorUserId,
      requestId,
      actorType: 'user',
      action: 'roles.permission_assigned',
      module: 'roles',
      entityType: 'role',
      entityId: roleId,
      changes: { permissionId, permissionKey: permission.key },
    });

    return rolePermission;
  }

  async removePermission(
    roleId: string,
    permissionId: string,
    actorUserId: string,
    requestId?: string,
  ) {
    const role = await this.findOne(roleId);

    const existing = await this.prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId, permissionId } },
    });

    if (!existing) {
      throw new NotFoundException(`Permission ${permissionId} is not assigned to role ${roleId}`);
    }

    await this.prisma.rolePermission.delete({
      where: { roleId_permissionId: { roleId, permissionId } },
    });

    await this.auditLogs.create({
      schoolId: role.schoolId ?? undefined,
      userId: actorUserId,
      requestId,
      actorType: 'user',
      action: 'roles.permission_removed',
      module: 'roles',
      entityType: 'role',
      entityId: roleId,
      changes: { permissionId },
    });

    return { roleId, permissionId, removed: true };
  }
}
