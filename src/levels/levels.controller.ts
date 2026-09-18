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
import { LevelsService } from './levels.service';
import { CreateLevelDto } from './dto/create-level.dto';
import { QueryLevelsDto } from './dto/query-levels.dto';
import { UpdateLevelDto } from './dto/update-level.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { successResponse } from '../common/utils/response.util';

@Controller('levels')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LevelsController {
  constructor(private readonly levelsService: LevelsService) {}

  @Post()
  @RequirePermissions('levels.create')
  async create(
    @Body() dto: CreateLevelDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    const data = await this.levelsService.create(
      dto,
      user.sub,
      user.schoolId,
      requestId,
    );
    return successResponse(data, 'Level created successfully');
  }

  @Get()
  @RequirePermissions('levels.read')
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryLevelsDto,
  ) {
    const data = await this.levelsService.findAll(user.schoolId, query.includeArchived);
    return successResponse(data, 'Levels retrieved successfully');
  }

  @Get(':id')
  @RequirePermissions('levels.read')
  async findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const data = await this.levelsService.findOne(id, user.schoolId);
    return successResponse(data, 'Level retrieved successfully');
  }

  @Patch(':id')
  @RequirePermissions('levels.update')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateLevelDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    const data = await this.levelsService.update(
      id,
      dto,
      user.sub,
      user.schoolId,
      requestId,
    );
    return successResponse(data, 'Level updated successfully');
  }

  @Post(':id/archive')
  @RequirePermissions('levels.archive')
  async archive(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    const data = await this.levelsService.archive(
      id,
      user.sub,
      user.schoolId,
      requestId,
    );
    return successResponse(data, 'Level archived successfully');
  }

  @Post(':id/restore')
  @RequirePermissions('levels.archive')
  async restore(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
  ) {
    const data = await this.levelsService.restore(
      id,
      user.sub,
      user.schoolId,
      req.requestId,
    );
    return successResponse(data, 'Level restored successfully');
  }
}
