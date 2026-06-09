import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AcademicYearsService } from './academic-years.service';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { UpdateAcademicYearDto } from './dto/update-academic-year.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { successResponse } from '../common/utils/response.util';

@Controller('academic-years')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AcademicYearsController {
  constructor(private readonly academicYearsService: AcademicYearsService) {}

  @Post()
  @RequirePermissions('academic_years.create')
  async create(
    @Body() dto: CreateAcademicYearDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    const data = await this.academicYearsService.create(
      dto,
      user.sub,
      user.schoolId,
      requestId,
    );
    return successResponse(data, 'Academic year created successfully');
  }

  @Get()
  @RequirePermissions('academic_years.read')
  async findAll(@CurrentUser() user: JwtPayload) {
    const data = await this.academicYearsService.findAll(user.schoolId);
    return successResponse(data, 'Academic years retrieved successfully');
  }

  @Get(':id')
  @RequirePermissions('academic_years.read')
  async findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const data = await this.academicYearsService.findOne(id, user.schoolId);
    return successResponse(data, 'Academic year retrieved successfully');
  }

  @Patch(':id')
  @RequirePermissions('academic_years.update')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAcademicYearDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    const data = await this.academicYearsService.update(
      id,
      dto,
      user.sub,
      user.schoolId,
      requestId,
    );
    return successResponse(data, 'Academic year updated successfully');
  }

  @Post(':id/activate')
  @RequirePermissions('academic_years.activate')
  async activate(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    const data = await this.academicYearsService.activate(
      id,
      user.sub,
      user.schoolId,
      requestId,
    );
    return successResponse(data, 'Academic year activated successfully');
  }

  @Post(':id/close')
  @RequirePermissions('academic_years.close')
  async close(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    const data = await this.academicYearsService.close(
      id,
      user.sub,
      user.schoolId,
      requestId,
    );
    return successResponse(data, 'Academic year closed successfully');
  }
}
