import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { StaffService } from './staff.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { QueryStaffDto } from './dto/query-staff.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { successResponse, paginatedResponse } from '../common/utils/response.util';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Post()
  @RequirePermissions('staff.create')
  async create(
    @Body() dto: CreateStaffDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
  ) {
    const staff = await this.staffService.create(
      dto,
      user.sub,
      user.schoolId,
      req.requestId,
    );
    return successResponse(staff, 'Staff member created successfully');
  }

  @Get()
  @RequirePermissions('staff.read')
  async findAll(@CurrentUser() user: JwtPayload, @Query() query: QueryStaffDto) {
    const result = await this.staffService.findAll(user.schoolId, query);
    return paginatedResponse(
      result.items,
      result.pagination.total,
      result.pagination.page,
      result.pagination.limit,
      'Staff members retrieved successfully',
    );
  }

  @Get(':id')
  @RequirePermissions('staff.read')
  async findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const staff = await this.staffService.findOne(id, user.schoolId);
    return successResponse(staff, 'Staff member retrieved successfully');
  }

  @Patch(':id')
  @RequirePermissions('staff.update')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateStaffDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
  ) {
    const staff = await this.staffService.update(
      id,
      dto,
      user.sub,
      user.schoolId,
      req.requestId,
    );
    return successResponse(staff, 'Staff member updated successfully');
  }

  @Post(':id/archive')
  @RequirePermissions('staff.archive')
  async archive(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
  ) {
    const staff = await this.staffService.archive(
      id,
      user.sub,
      user.schoolId,
      req.requestId,
    );
    return successResponse(staff, 'Staff member archived successfully');
  }

  @Post(':id/restore')
  @RequirePermissions('staff.archive')
  async restore(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
  ) {
    const data = await this.staffService.restore(
      id,
      user.sub,
      user.schoolId,
      req.requestId,
    );
    return successResponse(data, 'Staff member restored successfully');
  }
}
