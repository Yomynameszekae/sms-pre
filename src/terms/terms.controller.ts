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
import { TermsService } from './terms.service';
import { CreateTermDto } from './dto/create-term.dto';
import { UpdateTermDto } from './dto/update-term.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { successResponse } from '../common/utils/response.util';

@Controller('terms')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TermsController {
  constructor(private readonly termsService: TermsService) {}

  @Post()
  @RequirePermissions('terms.create')
  async create(
    @Body() dto: CreateTermDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    const data = await this.termsService.create(
      dto,
      user.sub,
      user.schoolId,
      requestId,
    );
    return successResponse(data, 'Term created successfully');
  }

  @Get()
  @RequirePermissions('terms.read')
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query('academicYearId') academicYearId?: string,
  ) {
    const data = await this.termsService.findAll(user.schoolId, academicYearId);
    return successResponse(data, 'Terms retrieved successfully');
  }

  @Get(':id')
  @RequirePermissions('terms.read')
  async findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const data = await this.termsService.findOne(id, user.schoolId);
    return successResponse(data, 'Term retrieved successfully');
  }

  @Patch(':id')
  @RequirePermissions('terms.update')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTermDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    const data = await this.termsService.update(
      id,
      dto,
      user.sub,
      user.schoolId,
      requestId,
    );
    return successResponse(data, 'Term updated successfully');
  }

  @Post(':id/activate')
  @RequirePermissions('terms.activate')
  async activate(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    const data = await this.termsService.activate(
      id,
      user.sub,
      user.schoolId,
      requestId,
    );
    return successResponse(data, 'Term activated successfully');
  }

  @Post(':id/close')
  @RequirePermissions('terms.close')
  async close(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    const data = await this.termsService.close(
      id,
      user.sub,
      user.schoolId,
      requestId,
    );
    return successResponse(data, 'Term closed successfully');
  }
}
