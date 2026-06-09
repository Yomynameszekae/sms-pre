import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { DocumentSequenceType } from '@prisma/client';
import { DocumentSequencesService } from './document-sequences.service';
import { UpdateSequenceDto } from './dto/update-sequence.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { successResponse } from '../common/utils/response.util';

@Controller('document-sequences')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DocumentSequencesController {
  constructor(private readonly documentSequencesService: DocumentSequencesService) {}

  @Get()
  @RequirePermissions('document_sequences.read')
  async findAll(@CurrentUser() user: JwtPayload) {
    const data = await this.documentSequencesService.findAll(user.schoolId);
    return successResponse(data, 'Document sequences retrieved successfully');
  }

  @Get(':type')
  @RequirePermissions('document_sequences.read')
  async findByType(
    @CurrentUser() user: JwtPayload,
    @Param('type') type: DocumentSequenceType,
  ) {
    const data = await this.documentSequencesService.findByType(user.schoolId, type);
    return successResponse(data, 'Document sequence retrieved successfully');
  }

  @Post(':type/generate')
  @RequirePermissions('document_sequences.generate')
  async generateNext(
    @CurrentUser() user: JwtPayload,
    @Param('type') type: DocumentSequenceType,
    @Req() req: Request,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    const data = await this.documentSequencesService.generateNext(
      user.schoolId,
      type,
      user.sub,
      requestId,
    );
    return successResponse(data, 'Document sequence number generated successfully');
  }

  @Patch(':type')
  @RequirePermissions('document_sequences.update')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('type') type: DocumentSequenceType,
    @Body() dto: UpdateSequenceDto,
    @Req() req: Request,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    const data = await this.documentSequencesService.update(
      user.schoolId,
      type,
      dto,
      user.sub,
      requestId,
    );
    return successResponse(data, 'Document sequence updated successfully');
  }
}
