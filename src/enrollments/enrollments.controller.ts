import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { EnrollmentsService } from './enrollments.service';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { UpdateEnrollmentDto } from './dto/update-enrollment.dto';
import { WithdrawEnrollmentDto } from './dto/withdraw-enrollment.dto';
import { QueryEnrollmentsDto } from './dto/query-enrollments.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { successResponse, paginatedResponse } from '../common/utils/response.util';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Post()
  @RequirePermissions('enrollments.create')
  async create(
    @Body() dto: CreateEnrollmentDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const data = await this.enrollmentsService.create(
      dto,
      user.sub,
      user.schoolId,
      (req as any).requestId,
    );
    return successResponse(data, 'Enrollment created successfully');
  }

  @Get()
  @RequirePermissions('enrollments.read')
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryEnrollmentsDto,
  ) {
    const result = await this.enrollmentsService.findAll(user.schoolId, query);
    return paginatedResponse(
      result.items,
      result.pagination.total,
      result.pagination.page,
      result.pagination.limit,
      'Enrollments retrieved successfully',
    );
  }

  @Get(':id')
  @RequirePermissions('enrollments.read')
  async findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const data = await this.enrollmentsService.findOne(id, user.schoolId);
    return successResponse(data, 'Enrollment retrieved successfully');
  }

  @Patch(':id')
  @RequirePermissions('enrollments.update')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateEnrollmentDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const data = await this.enrollmentsService.update(
      id,
      dto,
      user.sub,
      user.schoolId,
      (req as any).requestId,
    );
    return successResponse(data, 'Enrollment updated successfully');
  }

  @Post(':id/withdraw')
  @RequirePermissions('enrollments.withdraw')
  async withdraw(
    @Param('id') id: string,
    @Body() dto: WithdrawEnrollmentDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const data = await this.enrollmentsService.withdraw(
      id,
      dto,
      user.sub,
      user.schoolId,
      (req as any).requestId,
    );
    return successResponse(data, 'Enrollment withdrawn successfully');
  }
}
