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
import { LabelsService } from './labels.service';
import { CreateLabelDto } from './dto/create-label.dto';
import { UpdateLabelDto } from './dto/update-label.dto';
import { QueryLabelsDto } from './dto/query-labels.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { successResponse } from '../common/utils/response.util';

@Controller('labels')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LabelsController {
  constructor(private readonly labelsService: LabelsService) {}

  @Post()
  @RequirePermissions('labels.create')
  async create(
    @Body() dto: CreateLabelDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    const data = await this.labelsService.create(dto, user.sub, user.schoolId, requestId);
    return successResponse(data, 'Label created successfully');
  }

  @Get()
  @RequirePermissions('labels.read')
  async findAll(@CurrentUser() user: JwtPayload, @Query() query: QueryLabelsDto) {
    const data = await this.labelsService.findAll(user.schoolId, query);
    return successResponse(data, 'Labels retrieved successfully');
  }

  @Get(':id')
  @RequirePermissions('labels.read')
  async findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const data = await this.labelsService.findOne(id, user.schoolId);
    return successResponse(data, 'Label retrieved successfully');
  }

  @Patch(':id')
  @RequirePermissions('labels.update')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateLabelDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    const data = await this.labelsService.update(id, dto, user.sub, user.schoolId, requestId);
    return successResponse(data, 'Label updated successfully');
  }

  @Post(':id/archive')
  @RequirePermissions('labels.archive')
  async archive(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    const data = await this.labelsService.archive(id, user.sub, user.schoolId, requestId);
    return successResponse(data, 'Label archived successfully');
  }

  @Post(':id/restore')
  @RequirePermissions('labels.archive')
  async restore(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    const data = await this.labelsService.restore(id, user.sub, user.schoolId, requestId);
    return successResponse(data, 'Label restored successfully');
  }
}
