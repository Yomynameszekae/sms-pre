import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AssignPermissionDto } from './dto/assign-permission.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { successResponse } from '../common/utils/response.util';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post()
  @RequirePermissions('roles.create')
  async create(@Body() dto: CreateRoleDto, @CurrentUser() user: JwtPayload) {
    const data = await this.rolesService.create(dto, user.sub, user.schoolId);
    return successResponse(data, 'Role created successfully');
  }

  @Get()
  @RequirePermissions('roles.read')
  async findAll(@CurrentUser() user: JwtPayload) {
    const data = await this.rolesService.findAll(user.schoolId);
    return successResponse(data, 'Roles retrieved successfully');
  }

  @Get(':id')
  @RequirePermissions('roles.read')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.rolesService.findOne(id);
    return successResponse(data, 'Role retrieved successfully');
  }

  @Patch(':id')
  @RequirePermissions('roles.update')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.rolesService.update(id, dto, user.sub);
    return successResponse(data, 'Role updated successfully');
  }

  @Post(':id/permissions')
  @RequirePermissions('roles.assign_permissions')
  async assignPermission(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignPermissionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.rolesService.assignPermission(id, dto.permissionId, user.sub);
    return successResponse(data, 'Permission assigned successfully');
  }

  @Delete(':id/permissions/:permissionId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('roles.assign_permissions')
  async removePermission(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('permissionId', ParseUUIDPipe) permissionId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.rolesService.removePermission(id, permissionId, user.sub);
    return successResponse(data, 'Permission removed successfully');
  }
}
