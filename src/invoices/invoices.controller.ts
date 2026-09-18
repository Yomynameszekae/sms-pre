import {
  Body, Controller, Get, Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CancelInvoiceDto } from './dto/cancel-invoice.dto';
import { CorrectInvoiceDto } from './dto/correct-invoice.dto';
import { QueryInvoicesDto } from './dto/query-invoices.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { successResponse } from '../common/utils/response.util';

@Controller('invoices')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Post()
  @RequirePermissions('invoices.create')
  async create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: JwtPayload, @Req() req: Request) {
    const data = await this.invoices.create(dto, user.sub, user.schoolId, (req as any).requestId);
    return successResponse(data, 'Invoice issued successfully');
  }

  @Get()
  @RequirePermissions('invoices.read')
  async findAll(@Query() query: QueryInvoicesDto, @CurrentUser() user: JwtPayload) {
    const data = await this.invoices.findAll(query, user.schoolId);
    return successResponse(data, 'Invoices retrieved successfully');
  }

  @Get(':id')
  @RequirePermissions('invoices.read')
  async findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const data = await this.invoices.findOne(id, user.schoolId);
    return successResponse(data, 'Invoice retrieved successfully');
  }

  @Post(':id/cancel')
  @RequirePermissions('invoices.cancel')
  async cancel(
    @Param('id') id: string,
    @Body() dto: CancelInvoiceDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const data = await this.invoices.cancel(id, dto, user.sub, user.schoolId, (req as any).requestId);
    return successResponse(data, 'Invoice cancelled');
  }

  /**
   * Cancel-and-reissue in one transaction.
   *
   * Requires BOTH `invoices.cancel` and `invoices.create` — a correcting user
   * needs both authorities, and there is deliberately no third permission key
   * for it. `RequirePermissions` is all-of, so listing both is the whole
   * enforcement.
   */
  @Post(':id/correct')
  @RequirePermissions('invoices.cancel', 'invoices.create')
  async correct(
    @Param('id') id: string,
    @Body() dto: CorrectInvoiceDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const data = await this.invoices.correct(id, dto, user.sub, user.schoolId, (req as any).requestId);
    return successResponse(data, 'Invoice corrected and reissued');
  }
}
