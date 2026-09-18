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
  Req,
} from '@nestjs/common';
import { GuardiansService } from './guardians.service';
import { CreateGuardianDto } from './dto/create-guardian.dto';
import { UpdateGuardianDto } from './dto/update-guardian.dto';
import { QueryGuardiansDto } from './dto/query-guardians.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { successResponse, paginatedResponse } from '../common/utils/response.util';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('guardians')
export class GuardiansController {
  constructor(private readonly guardiansService: GuardiansService) {}

  @Post()
  @RequirePermissions('guardians.create')
  async create(
    @Body() dto: CreateGuardianDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
  ) {
    const guardian = await this.guardiansService.create(
      dto,
      user.sub,
      user.schoolId,
      req.requestId,
    );
    return successResponse(guardian, 'Guardian created successfully');
  }

  @Get()
  @RequirePermissions('guardians.read')
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryGuardiansDto,
  ) {
    const result = await this.guardiansService.findAll(user.schoolId, query);
    return paginatedResponse(
      result.items,
      result.pagination.total,
      result.pagination.page,
      result.pagination.limit,
      'Guardians retrieved successfully',
    );
  }

  @Get(':id')
  @RequirePermissions('guardians.read')
  async findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const guardian = await this.guardiansService.findOne(id, user.schoolId);
    return successResponse(guardian, 'Guardian retrieved successfully');
  }

  @Patch(':id')
  @RequirePermissions('guardians.update')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateGuardianDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
  ) {
    const guardian = await this.guardiansService.update(
      id,
      dto,
      user.sub,
      user.schoolId,
      req.requestId,
    );
    return successResponse(guardian, 'Guardian updated successfully');
  }

  @Post(':id/archive')
  @RequirePermissions('guardians.archive')
  async archive(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
  ) {
    const guardian = await this.guardiansService.archive(
      id,
      user.sub,
      user.schoolId,
      req.requestId,
    );
    return successResponse(guardian, 'Guardian archived successfully');
  }

  @Get(':id/students')
  @RequirePermissions('guardians.read')
  async getStudents(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const students = await this.guardiansService.getStudents(id, user.schoolId);
    return successResponse(students, 'Guardian students retrieved successfully');
  }
}
