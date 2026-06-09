import { Controller, Get, Param, UseGuards, ParseUUIDPipe, NotFoundException } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { successResponse } from '../common/utils/response.util';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('permissions.read')
  async findAll() {
    const data = await this.prisma.permission.findMany({
      select: {
        id: true,
        key: true,
        module: true,
        description: true,
        createdAt: true,
      },
      orderBy: [{ module: 'asc' }, { key: 'asc' }],
    });
    return successResponse(data, 'Permissions retrieved successfully');
  }

  @Get(':id')
  @RequirePermissions('permissions.read')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.prisma.permission.findUnique({
      where: { id },
      select: {
        id: true,
        key: true,
        module: true,
        description: true,
        createdAt: true,
      },
    });

    if (!data) {
      throw new NotFoundException(`Permission ${id} not found`);
    }

    return successResponse(data, 'Permission retrieved successfully');
  }
}
