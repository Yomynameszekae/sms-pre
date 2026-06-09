import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { SchoolSettingsService } from './school-settings.service';
import { UpdateSchoolSettingDto } from './dto/update-school-setting.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { successResponse } from '../common/utils/response.util';

@Controller('school-settings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SchoolSettingsController {
  constructor(private readonly schoolSettingsService: SchoolSettingsService) {}

  @Get()
  @RequirePermissions('school_settings.read')
  async findAll(@CurrentUser() user: JwtPayload) {
    const data = await this.schoolSettingsService.findAll(user.schoolId);
    return successResponse(data, 'School settings retrieved successfully');
  }

  @Get(':key')
  @RequirePermissions('school_settings.read')
  async findByKey(@CurrentUser() user: JwtPayload, @Param('key') key: string) {
    const data = await this.schoolSettingsService.findByKey(user.schoolId, key);
    return successResponse(data, 'School setting retrieved successfully');
  }

  @Patch(':key')
  @RequirePermissions('school_settings.update')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('key') key: string,
    @Body() dto: UpdateSchoolSettingDto,
    @Req() req: Request,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    const data = await this.schoolSettingsService.update(
      user.schoolId,
      key,
      dto.valueJson,
      user.sub,
      requestId,
    );
    return successResponse(data, 'School setting updated successfully');
  }
}
