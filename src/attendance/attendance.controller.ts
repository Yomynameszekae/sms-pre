import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AttendanceService } from './attendance.service';
import {
  CLASSROOM_REGISTER_EXPORTS,
  CLASSROOM_TERM_EXPORTS,
  resolveExport,
} from './attendance.formatter';
import { MarkRegisterDto } from './dto/mark-register.dto';
import { QueryRegisterDto } from './dto/query-register.dto';
import { QueryRegisterGridDto } from './dto/query-register-grid.dto';
import { QuerySummaryDto } from './dto/query-summary.dto';
import { ReopenTermDto } from './dto/reopen-term.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import {
  RequirePermissions,
  RequireAnyPermission,
} from '../common/decorators/require-permissions.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { successResponse } from '../common/utils/response.util';

/**
 * Authorisation here is two-layered, on purpose.
 *
 *   1. PermissionsGuard answers "may this caller reach the endpoint at all",
 *      using `RequireAnyPermission` because a Class Teacher holds
 *      `attendance.read` and a Headteacher holds `attendance.read_any` and
 *      neither holds both.
 *   2. AttendanceService answers "which classrooms", by resolving the
 *      caller's linked Staff id and comparing it to Classroom.classTeacherId.
 *      Holding the `_any` variant bypasses that check.
 *
 * The guard never learns about resources; the service never re-checks the
 * permission key. This is Brite's first row-level authorisation and the
 * pattern later scoped modules should copy.
 */
@Controller('attendance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  /** Classrooms the caller may open a register for — the picker's source. */
  @Get('classrooms')
  @RequireAnyPermission('attendance.read', 'attendance.read_any')
  async classrooms(
    @CurrentUser() user: JwtPayload,
    @Query('academicYearId') academicYearId?: string,
  ) {
    const data = await this.attendanceService.listAccessibleClassrooms(user, academicYearId);
    return successResponse(data, 'Classrooms retrieved successfully');
  }

  /** The roster left-joined onto the day's records. */
  @Get('register')
  @RequireAnyPermission('attendance.read', 'attendance.read_any')
  async register(@CurrentUser() user: JwtPayload, @Query() query: QueryRegisterDto) {
    const data = await this.attendanceService.getRegister(user, query);
    return successResponse(data, 'Register retrieved successfully');
  }

  /** Create AND amend. Idempotent — see AttendanceService.markRegister. */
  @Put('register')
  @RequireAnyPermission('attendance.mark', 'attendance.mark_any')
  async markRegister(
    @Body() dto: MarkRegisterDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    const data = await this.attendanceService.markRegister(user, dto, requestId);
    return successResponse(data, 'Register saved successfully');
  }

  @Get('summary/student/:studentId')
  @RequireAnyPermission('attendance.read', 'attendance.read_any')
  async studentSummary(
    @Param('studentId') studentId: string,
    @CurrentUser() user: JwtPayload,
    @Query() query: QuerySummaryDto,
  ) {
    const data = await this.attendanceService.studentTermSummary(
      user,
      studentId,
      query.termId,
    );
    return successResponse(data, 'Student attendance summary retrieved successfully');
  }

  @Get('summary/classroom/:classroomId')
  @RequireAnyPermission('attendance.read', 'attendance.read_any')
  async classroomSummary(
    @Param('classroomId') classroomId: string,
    @CurrentUser() user: JwtPayload,
    @Query() query: QuerySummaryDto,
  ) {
    const data = await this.attendanceService.classroomTermSummary(
      user,
      classroomId,
      query.termId,
    );
    return successResponse(data, 'Classroom attendance summary retrieved successfully');
  }

  /**
   * The same data as the JSON summary above, rendered by a registered format.
   *
   * The controller does no formatting of its own and no format switching
   * either: it fetches a view shape, resolves `?format=` against the registry
   * in attendance.formatter.ts, and hands the view to whichever pure function
   * that names. Adding a format is one registry entry — this method does not
   * change. `format` defaults to `csv`, so the shipped URL keeps working
   * unchanged.
   */
  @Get('summary/classroom/:classroomId/export')
  @RequireAnyPermission('attendance.read', 'attendance.read_any')
  async classroomSummaryExport(
    @Param('classroomId') classroomId: string,
    @CurrentUser() user: JwtPayload,
    @Query() query: QuerySummaryDto,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ) {
    const chosen = this.pick(CLASSROOM_TERM_EXPORTS, format, 'csv');
    const summary = await this.attendanceService.classroomTermSummary(
      user,
      classroomId,
      query.termId,
    );
    this.send(res, chosen.contentType, chosen.filename(summary), chosen.render(summary));
  }

  /**
   * The printable register: students down, dates across, AM and PM per cell.
   *
   * A DIFFERENT read from the term summary, not a different formatter over
   * it — the per-date detail a grid needs is not in a summary view. Same
   * authorisation, same reporting rule.
   */
  @Get('register/grid')
  @RequireAnyPermission('attendance.read', 'attendance.read_any')
  async registerGrid(
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryRegisterGridDto,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ) {
    const grid = await this.attendanceService.classroomRegisterGrid(user, query);

    // No `format` at all means "give me the data": the JSON view, for a client
    // that renders its own. A named format goes through the registry.
    if (!format) {
      res.json(successResponse(grid, 'Register grid retrieved successfully'));
      return;
    }

    const chosen = this.pick(CLASSROOM_REGISTER_EXPORTS, format, 'register');
    this.send(res, chosen.contentType, chosen.filename(grid), chosen.render(grid));
  }

  /** Registry lookup, with an unknown value turned into a 400 listing the valid ones. */
  private pick<TView>(
    registry: Record<string, import('./attendance.formatter').AttendanceExport<TView>>,
    format: string | undefined,
    fallback: string,
  ) {
    try {
      return resolveExport(registry, format, fallback);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  private send(res: Response, contentType: string, filename: string, body: string | Buffer) {
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  }

  /**
   * Reopen a closed term's register. Super Admin only — enforced by ROLE in
   * the service, not by a permission key, because SCHOOL_ADMIN's seeded grant
   * is every permission and would inherit a new key automatically. The guard
   * below is only a coarse gate.
   */
  @Post('terms/:termId/reopen')
  @RequirePermissions('attendance.mark_any')
  async reopenTerm(
    @Param('termId') termId: string,
    @Body() dto: ReopenTermDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    const data = await this.attendanceService.reopenTerm(user, termId, dto, requestId);
    return successResponse(data, 'Term register reopened for amendment');
  }
}
