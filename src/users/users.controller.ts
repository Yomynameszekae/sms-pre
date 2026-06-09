import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { successResponse, paginatedResponse } from '../common/utils/response.util';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @RequirePermissions('users.create')
  async create(@Body() dto: CreateUserDto, @CurrentUser() user: JwtPayload) {
    const data = await this.usersService.create(dto, user.sub, user.schoolId);
    return successResponse(data, 'User created successfully');
  }

  @Get()
  @RequirePermissions('users.read')
  async findAll(@Query() query: QueryUsersDto, @CurrentUser() user: JwtPayload) {
    const result = await this.usersService.findAll(user.schoolId, query);
    return paginatedResponse(
      result.items,
      result.pagination.total,
      result.pagination.page,
      result.pagination.limit,
      'Users retrieved successfully',
    );
  }

  @Get(':id')
  @RequirePermissions('users.read')
  async findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    const data = await this.usersService.findOne(id, user.schoolId);
    return successResponse(data, 'User retrieved successfully');
  }

  @Patch(':id')
  @RequirePermissions('users.update')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.usersService.update(id, dto, user.sub, user.schoolId);
    return successResponse(data, 'User updated successfully');
  }

  @Patch(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.deactivate')
  async deactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    const data = await this.usersService.deactivate(id, user.sub, user.schoolId);
    return successResponse(data, 'User deactivated successfully');
  }

  @Post(':id/roles')
  @RequirePermissions('users.manage_roles')
  async assignRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('roleId', ParseUUIDPipe) roleId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.usersService.assignRole(id, roleId, user.sub, user.schoolId);
    return successResponse(data, 'Role assigned successfully');
  }

  @Delete(':id/roles/:roleId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.manage_roles')
  async removeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.usersService.removeRole(id, roleId, user.sub, user.schoolId);
    return successResponse(data, 'Role removed successfully');
  }
}
