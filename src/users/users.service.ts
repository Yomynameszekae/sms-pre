import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { hashPassword } from '../common/utils/hash.util';
import { isUniqueViolationOn } from '../common/utils/document-number.util';
import { getPaginationParams, paginate } from '../common/utils/pagination.util';
import { CreateUserDto, LinkedEntityType } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';

/**
 * The user shape `create` and `update` return — both use the same `select`,
 * so the type is declared once rather than inlined twice.
 */
type UserSummary = {
  id: string;
  schoolId: string;
  email: string | null;
  phone: string | null;
  linkedEntityType: string;
  linkedEntityId: string;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private auditLogs: AuditLogsService,
  ) {}

  /**
   * Turns a unique violation on one of the three user indexes into a 409 that
   * names the offending field, instead of the 500 an unhandled P2002 produces.
   *
   * All three indexes are RAW SQL (see the inventory in README.md) — Prisma's
   * schema declares none of them. That does not matter here: Prisma reports
   * P2002 `meta.target` as the COLUMN LIST regardless of whether it owns the
   * index, verified against the live database:
   *
   *   uq_users_school_email_lower   → ["school_id","lower(email::text)"]
   *   uq_users_school_phone         → ["school_id","phone"]
   *   uq_users_school_linked_entity → ["school_id","linked_entity_type","linked_entity_id"]
   *
   * So the hints below match column names, not index names — do not "fix" them
   * to index names, and re-check them if any of those indexes is ever promoted
   * into the Prisma schema.
   *
   * Returns the original error untouched when it is not one of these, so the
   * caller always rethrows something.
   */
  private mapUniqueViolation(err: unknown, linkedEntityType?: string): unknown {
    if (isUniqueViolationOn(err, /linked_entity_id/)) {
      // The non-obvious one: the email is free but the staff/guardian already
      // holds an account, so the message has to say which rule was hit.
      const noun = linkedEntityType === 'guardian' ? 'guardian' : 'staff member';
      return new ConflictException(
        `This ${noun} already has a user account. Each ${noun} may only have one login.`,
      );
    }
    // lower(email::text) — the index is case-insensitive, and the message says so.
    if (isUniqueViolationOn(err, /email/)) {
      return new ConflictException(
        'A user with this email address already exists in this school (email is matched case-insensitively)',
      );
    }
    if (isUniqueViolationOn(err, /phone/)) {
      return new ConflictException(
        'A user with this phone number already exists in this school',
      );
    }
    return err;
  }

  async create(dto: CreateUserDto, actorUserId: string, schoolId: string, requestId?: string) {
    // The staff link is a POLYMORPHIC SOFT REFERENCE — linked_entity_type plus
    // linked_entity_id, with no foreign key, so the database will happily
    // store an id that matches no row. Nothing then reports the account as
    // broken: it signs in, and only the screens that resolve the staff member
    // behave oddly. Check it here, where the id first arrives, because there
    // is no constraint further down that will.
    if (dto.linkedEntityType === LinkedEntityType.STAFF) {
      const staff = await this.prisma.staff.findFirst({
        where: { id: dto.linkedEntityId, schoolId },
        select: { id: true },
      });
      if (!staff) {
        throw new NotFoundException(
          'No staff member with that id exists in this school, so a login cannot be linked to them.',
        );
      }
    }

    const passwordHash = await hashPassword(dto.password);

    let user: UserSummary;

    try {
      user = await this.prisma.user.create({
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
    } catch (err) {
      throw this.mapUniqueViolation(err, dto.linkedEntityType);
    }

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
    const existing = await this.findOne(id, schoolId);

    // Same exposure as create: `email` and `phone` are both editable and both
    // carry a raw-SQL unique index, so an edit collides exactly as a create
    // does. linkedEntity is not editable here, so it cannot fire.
    let updated: UserSummary;
    try {
      updated = await this.prisma.user.update({
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
    } catch (err) {
      throw this.mapUniqueViolation(err, existing.linkedEntityType);
    }

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
