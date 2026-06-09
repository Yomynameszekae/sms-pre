import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { SchoolService } from './school.service';
import { UpdateSchoolDto } from './dto/update-school.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { successResponse } from '../common/utils/response.util';

@Controller('school')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SchoolController {
  constructor(private readonly schoolService: SchoolService) {}

  @Get()
  @RequirePermissions('school.read')
  async findOne(@CurrentUser() user: JwtPayload) {
    const data = await this.schoolService.findOne(user.schoolId);
    return successResponse(data, 'School retrieved successfully');
  }

  @Patch()
  @RequirePermissions('school.update')
  async update(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateSchoolDto,
    @Req() req: Request,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    const data = await this.schoolService.update(user.schoolId, dto, user.sub, requestId);
    return successResponse(data, 'School updated successfully');
  }
}
