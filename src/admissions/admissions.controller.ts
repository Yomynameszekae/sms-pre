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
import { AdmissionsService } from './admissions.service';
import { CreateAdmissionDto } from './dto/create-admission.dto';
import { UpdateAdmissionDto } from './dto/update-admission.dto';
import { OfferAdmissionDto } from './dto/offer-admission.dto';
import { TransitionNotesDto } from './dto/transition-admission.dto';
import { EnrollAdmissionDto } from './dto/enroll-admission.dto';
import { QueryAdmissionsDto } from './dto/query-admissions.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { successResponse, paginatedResponse } from '../common/utils/response.util';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admissions')
export class AdmissionsController {
  constructor(private readonly admissionsService: AdmissionsService) {}

  @Post()
  @RequirePermissions('admissions.create')
  async create(
    @Body() dto: CreateAdmissionDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const data = await this.admissionsService.create(
      dto,
      user.sub,
      user.schoolId,
      (req as any).requestId,
    );
    return successResponse(data, 'Admission application created successfully');
  }

  @Get()
  @RequirePermissions('admissions.read')
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryAdmissionsDto,
  ) {
    const result = await this.admissionsService.findAll(user.schoolId, query);
    return paginatedResponse(
      result.items,
      result.pagination.total,
      result.pagination.page,
      result.pagination.limit,
      'Admission applications retrieved successfully',
    );
  }

  @Get(':id')
  @RequirePermissions('admissions.read')
  async findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const data = await this.admissionsService.findOne(id, user.schoolId);
    return successResponse(data, 'Admission application retrieved successfully');
  }

  @Patch(':id')
  @RequirePermissions('admissions.update')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAdmissionDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const data = await this.admissionsService.update(
      id,
      dto,
      user.sub,
      user.schoolId,
      (req as any).requestId,
    );
    return successResponse(data, 'Admission application updated successfully');
  }

  @Post(':id/offer')
  @RequirePermissions('admissions.approve')
  async offer(
    @Param('id') id: string,
    @Body() dto: OfferAdmissionDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const data = await this.admissionsService.offer(
      id,
      dto,
      user.sub,
      user.schoolId,
      (req as any).requestId,
    );
    return successResponse(data, 'Admission offer made successfully');
  }

  @Post(':id/apply')
  @RequirePermissions('admissions.update')
  async apply(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const data = await this.admissionsService.apply(
      id,
      user.sub,
      user.schoolId,
      (req as any).requestId,
    );
    return successResponse(data, 'Admission moved to application');
  }

  @Post(':id/revert-offer')
  @RequirePermissions('admissions.approve')
  async revertOffer(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const data = await this.admissionsService.revertOffer(
      id,
      user.sub,
      user.schoolId,
      (req as any).requestId,
    );
    return successResponse(data, 'Offer reverted');
  }

  @Post(':id/reject')
  @RequirePermissions('admissions.update')
  async reject(
    @Param('id') id: string,
    @Body() dto: TransitionNotesDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const data = await this.admissionsService.reject(
      id,
      dto,
      user.sub,
      user.schoolId,
      (req as any).requestId,
    );
    return successResponse(data, 'Admission rejected');
  }

  @Post(':id/withdraw')
  @RequirePermissions('admissions.update')
  async withdraw(
    @Param('id') id: string,
    @Body() dto: TransitionNotesDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const data = await this.admissionsService.withdraw(
      id,
      dto,
      user.sub,
      user.schoolId,
      (req as any).requestId,
    );
    return successResponse(data, 'Admission withdrawn');
  }

  @Post(':id/revert-enrollment')
  @RequirePermissions('admissions.enroll')
  async revertEnrollment(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const data = await this.admissionsService.revertEnrollment(
      id,
      user.sub,
      user.schoolId,
      (req as any).requestId,
    );
    return successResponse(data, 'Enrollment reverted — admission back to offered');
  }

  @Post(':id/enroll')
  @RequirePermissions('admissions.enroll')
  async enroll(
    @Param('id') id: string,
    @Body() dto: EnrollAdmissionDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const data = await this.admissionsService.enroll(
      id,
      dto,
      user.sub,
      user.schoolId,
      (req as any).requestId,
    );
    return successResponse(data, 'Student enrolled successfully');
  }
}
