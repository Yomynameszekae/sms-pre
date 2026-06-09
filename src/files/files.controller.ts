import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { FilesService } from './files.service';
import { CreateFileDto } from './dto/create-file.dto';
import { QueryFilesDto } from './dto/query-files.dto';
import { FileOwnerType } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { successResponse, paginatedResponse } from '../common/utils/response.util';

// TODO: Phase 2 — add binary file upload endpoint (multipart/form-data) with
// virus scanning, size limits, and signed upload URL generation via storage service.

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post()
  @RequirePermissions('files.upload')
  async create(
    @Body() dto: CreateFileDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const data = await this.filesService.create(
      dto,
      user.sub,
      user.schoolId,
      (req as any).requestId,
    );
    return successResponse(data, 'File metadata created successfully');
  }

  @Get()
  @RequirePermissions('files.read')
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryFilesDto,
  ) {
    const result = await this.filesService.findAll(user.schoolId, query);
    return paginatedResponse(
      result.items,
      result.pagination.total,
      result.pagination.page,
      result.pagination.limit,
      'Files retrieved successfully',
    );
  }

  // NOTE: This route must be declared before `:id` to avoid route shadowing
  @Get('owner/:ownerType/:ownerId')
  @RequirePermissions('files.read')
  async findByOwner(
    @Param('ownerType') ownerType: FileOwnerType,
    @Param('ownerId') ownerId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.filesService.findByOwner(user.schoolId, ownerType, ownerId);
    return successResponse(data, 'Files retrieved successfully');
  }

  @Get(':id')
  @RequirePermissions('files.read')
  async findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const data = await this.filesService.findOne(id, user.schoolId);
    return successResponse(data, 'File retrieved successfully');
  }

  @Post(':id/archive')
  @RequirePermissions('files.archive')
  async archive(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const data = await this.filesService.archive(
      id,
      user.sub,
      user.schoolId,
      (req as any).requestId,
    );
    return successResponse(data, 'File archived successfully');
  }
}
