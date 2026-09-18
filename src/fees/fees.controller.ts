import {
  Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { FeeTypesService } from './fee-types.service';
import { SchoolFeesService } from './school-fees.service';
import { FeePaymentsService } from './fee-payments.service';
import { FeeAssignmentsService } from './fee-assignments.service';
import { FeesReportingService } from './fees-reporting.service';
import { CreateFeeTypeDto } from './dto/create-fee-type.dto';
import { UpdateFeeTypeDto } from './dto/update-fee-type.dto';
import { QueryFeeTypesDto } from './dto/query-fee-types.dto';
import { CreateSchoolFeeDto } from './dto/create-school-fee.dto';
import { UpdateSchoolFeeDto } from './dto/update-school-fee.dto';
import { QuerySchoolFeesDto } from './dto/query-school-fees.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ReversePaymentDto } from './dto/reverse-payment.dto';
import { QueryPaymentsDto } from './dto/query-payments.dto';
import { UpdateAssignmentDto } from './dto/update-assignment.dto';
import { QueryFeeSummaryDto } from './dto/query-summary.dto';
import { QueryBillDto } from './dto/query-bill.dto';
import { QueryLedgerDto } from './dto/query-ledger.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { successResponse } from '../common/utils/response.util';

const rid = (req: Request) => (req as any).requestId as string | undefined;

/**
 * One controller for the fees bounded context. The routes are grouped by noun
 * under `/fees` so the whole module reads as one surface.
 *
 * NOTE on route ordering: the literal paths (`/fees/summary`, `/fees/ledger`)
 * are declared BEFORE any `/fees/:something` pattern would shadow them. There
 * is no such pattern here today, but adding one later above these would break
 * them silently.
 */
@Controller('fees')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FeesController {
  constructor(
    private readonly feeTypes: FeeTypesService,
    private readonly schoolFees: SchoolFeesService,
    private readonly payments: FeePaymentsService,
    private readonly assignments: FeeAssignmentsService,
    private readonly reporting: FeesReportingService,
  ) {}

  // ── fee types ─────────────────────────────────────────────────────────────

  @Post('types')
  @RequirePermissions('fee_types.create')
  async createType(@Body() dto: CreateFeeTypeDto, @CurrentUser() u: JwtPayload, @Req() req: Request) {
    return successResponse(
      await this.feeTypes.create(dto, u.sub, u.schoolId, rid(req)),
      'Fee type created successfully',
    );
  }

  @Get('types')
  @RequirePermissions('fee_types.read')
  async listTypes(@Query() query: QueryFeeTypesDto, @CurrentUser() u: JwtPayload) {
    return successResponse(await this.feeTypes.findAll(u.schoolId, query), 'Fee types retrieved successfully');
  }

  @Get('types/:id')
  @RequirePermissions('fee_types.read')
  async getType(@Param('id') id: string, @CurrentUser() u: JwtPayload) {
    return successResponse(await this.feeTypes.findOne(id, u.schoolId), 'Fee type retrieved successfully');
  }

  @Patch('types/:id')
  @RequirePermissions('fee_types.update')
  async updateType(
    @Param('id') id: string, @Body() dto: UpdateFeeTypeDto,
    @CurrentUser() u: JwtPayload, @Req() req: Request,
  ) {
    return successResponse(
      await this.feeTypes.update(id, dto, u.sub, u.schoolId, rid(req)),
      'Fee type updated successfully',
    );
  }

  @Post('types/:id/archive')
  @RequirePermissions('fee_types.archive')
  async archiveType(@Param('id') id: string, @CurrentUser() u: JwtPayload, @Req() req: Request) {
    return successResponse(
      await this.feeTypes.archive(id, u.sub, u.schoolId, rid(req)),
      'Fee type archived successfully',
    );
  }

  @Post('types/:id/restore')
  @RequirePermissions('fee_types.archive')
  async restoreType(@Param('id') id: string, @CurrentUser() u: JwtPayload, @Req() req: Request) {
    return successResponse(
      await this.feeTypes.restore(id, u.sub, u.schoolId, rid(req)),
      'Fee type restored successfully',
    );
  }

  // ── school fees ───────────────────────────────────────────────────────────

  @Post('school-fees')
  @RequirePermissions('school_fees.create')
  async createFee(@Body() dto: CreateSchoolFeeDto, @CurrentUser() u: JwtPayload, @Req() req: Request) {
    const data = await this.schoolFees.create(dto, u.sub, u.schoolId, rid(req));
    return successResponse(
      data,
      `Fee created and assigned to ${data.assignedCount} student(s)`,
    );
  }

  @Get('school-fees')
  @RequirePermissions('school_fees.read')
  async listFees(@Query() query: QuerySchoolFeesDto, @CurrentUser() u: JwtPayload) {
    return successResponse(await this.schoolFees.findAll(u.schoolId, query), 'Fees retrieved successfully');
  }

  @Get('school-fees/:id')
  @RequirePermissions('school_fees.read')
  async getFee(@Param('id') id: string, @CurrentUser() u: JwtPayload) {
    return successResponse(await this.schoolFees.findOne(id, u.schoolId), 'Fee retrieved successfully');
  }

  @Patch('school-fees/:id')
  @RequirePermissions('school_fees.update')
  async updateFee(
    @Param('id') id: string, @Body() dto: UpdateSchoolFeeDto,
    @CurrentUser() u: JwtPayload, @Req() req: Request,
  ) {
    return successResponse(
      await this.schoolFees.update(id, dto, u.sub, u.schoolId, rid(req)),
      'Fee updated. Existing assignments keep their original amount.',
    );
  }

  @Post('school-fees/:id/archive')
  @RequirePermissions('school_fees.archive')
  async archiveFee(@Param('id') id: string, @CurrentUser() u: JwtPayload, @Req() req: Request) {
    return successResponse(
      await this.schoolFees.archive(id, u.sub, u.schoolId, rid(req)),
      'Fee archived successfully',
    );
  }

  @Post('school-fees/:id/restore')
  @RequirePermissions('school_fees.archive')
  async restoreFee(@Param('id') id: string, @CurrentUser() u: JwtPayload, @Req() req: Request) {
    return successResponse(
      await this.schoolFees.restore(id, u.sub, u.schoolId, rid(req)),
      'Fee restored successfully',
    );
  }

  @Post('school-fees/:id/reconcile')
  @RequirePermissions('fee_assignments.reconcile')
  async reconcile(@Param('id') id: string, @CurrentUser() u: JwtPayload, @Req() req: Request) {
    const data = await this.schoolFees.reconcile(id, u.sub, u.schoolId, rid(req));
    return successResponse(
      data,
      data.createdCount
        ? `${data.createdCount} student(s) assigned this fee`
        : 'Every eligible student already has this fee',
    );
  }

  // ── assignments ───────────────────────────────────────────────────────────

  @Get('assignments/:id')
  @RequirePermissions('fee_assignments.read')
  async getAssignment(@Param('id') id: string, @CurrentUser() u: JwtPayload) {
    return successResponse(await this.assignments.findOne(id, u.schoolId), 'Fee assignment retrieved successfully');
  }

  @Patch('assignments/:id')
  @RequirePermissions('fee_assignments.reconcile')
  async updateAssignment(
    @Param('id') id: string, @Body() dto: UpdateAssignmentDto,
    @CurrentUser() u: JwtPayload, @Req() req: Request,
  ) {
    return successResponse(
      await this.assignments.update(id, dto, u.sub, u.schoolId, rid(req)),
      'Fee assignment updated successfully',
    );
  }

  // ── payments ──────────────────────────────────────────────────────────────

  @Post('payments')
  @RequirePermissions('fee_payments.create')
  async createPayment(@Body() dto: CreatePaymentDto, @CurrentUser() u: JwtPayload, @Req() req: Request) {
    const data = await this.payments.create(dto, u.sub, u.schoolId, rid(req));
    return successResponse(data, `Payment recorded — receipt ${data.receiptNumber}`);
  }

  @Get('payments')
  @RequirePermissions('fee_payments.read')
  async listPayments(@Query() query: QueryPaymentsDto, @CurrentUser() u: JwtPayload) {
    return successResponse(await this.payments.findAll(u.schoolId, query), 'Payments retrieved successfully');
  }

  @Get('payments/assignment/:feeAssignmentId')
  @RequirePermissions('fee_payments.read')
  async paymentsForAssignment(@Param('feeAssignmentId') id: string, @CurrentUser() u: JwtPayload) {
    return successResponse(
      await this.payments.findForAssignment(id, u.schoolId),
      'Payment history retrieved successfully',
    );
  }

  @Post('payments/:id/reverse')
  @RequirePermissions('fee_payments.reverse')
  async reversePayment(
    @Param('id') id: string, @Body() dto: ReversePaymentDto,
    @CurrentUser() u: JwtPayload, @Req() req: Request,
  ) {
    return successResponse(
      await this.payments.reverse(id, dto, u.sub, u.schoolId, rid(req)),
      'Payment reversed',
    );
  }

  // ── reporting ─────────────────────────────────────────────────────────────

  @Get('summary')
  @RequirePermissions('fees.report')
  async summary(@Query() query: QueryFeeSummaryDto, @CurrentUser() u: JwtPayload) {
    return successResponse(
      await this.reporting.levelSummary(query, u.schoolId),
      'Billing summary retrieved successfully',
    );
  }

  @Get('ledger')
  @RequirePermissions('fees.report')
  async ledger(@Query() query: QueryLedgerDto, @CurrentUser() u: JwtPayload) {
    return successResponse(await this.reporting.ledger(query, u.schoolId), 'Ledger retrieved successfully');
  }

  @Get('bill/:studentId')
  @RequirePermissions('fee_assignments.read')
  async bill(
    @Param('studentId') studentId: string,
    @Query() query: QueryBillDto,
    @CurrentUser() u: JwtPayload,
  ) {
    return successResponse(
      await this.reporting.bill(studentId, query.termId, u.schoolId),
      'Bill retrieved successfully',
    );
  }
}
