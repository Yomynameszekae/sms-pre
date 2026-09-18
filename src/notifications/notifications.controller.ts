import {
  Body, Controller, Get, Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { NotificationsLogService } from './notifications.log.service';
import { NotificationsTriggers } from './notifications.triggers';
import { NotificationsDispatcher } from './notifications.dispatcher';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { SendFeeRemindersDto } from './dto/send-fee-reminders.dto';
import { SendAbsenceAlertsDto } from './dto/send-absence-alerts.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { successResponse, paginatedResponse } from '../common/utils/response.util';

const rid = (req: Request) => (req as any).requestId as string | undefined;

@Controller('notifications')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class NotificationsController {
  constructor(
    private readonly log: NotificationsLogService,
    private readonly triggers: NotificationsTriggers,
    private readonly dispatcher: NotificationsDispatcher,
  ) {}

  @Get()
  @RequirePermissions('notifications.read')
  async findAll(@Query() query: QueryNotificationsDto, @CurrentUser() u: JwtPayload) {
    // Wrapped, like every other list endpoint in Brite — `paginate` returns
    // the bare { items, pagination } and the controller is what puts it in the
    // { success, message, data } envelope the frontend client unwraps.
    const result = await this.log.findAll(u.schoolId, query);
    return paginatedResponse(
      result.items,
      result.pagination.total,
      result.pagination.page,
      result.pagination.limit,
      'Notifications retrieved successfully',
    );
  }

  /** The badge source for the billing and register screens. */
  @Get('counts')
  @RequirePermissions('notifications.read')
  async counts(@CurrentUser() u: JwtPayload, @Query('since') since?: string) {
    return successResponse(await this.log.counts(u.schoolId, since), 'Counts retrieved successfully');
  }

  @Get(':id')
  @RequirePermissions('notifications.read')
  async findOne(@Param('id') id: string, @CurrentUser() u: JwtPayload) {
    return successResponse(await this.log.findOne(id, u.schoolId), 'Notification retrieved successfully');
  }

  /**
   * Fee reminders — manual and cost-bearing, so it needs its own permission
   * rather than riding on `fees.report`.
   */
  @Post('fee-reminders')
  @RequirePermissions('notifications.trigger')
  async feeReminders(
    @Body() dto: SendFeeRemindersDto, @CurrentUser() u: JwtPayload, @Req() req: Request,
  ) {
    const data = await this.triggers.feeReminders({
      schoolId: u.schoolId, termId: dto.termId, levelId: dto.levelId,
      studentId: dto.studentId, actorUserId: u.sub, requestId: rid(req),
    });
    return successResponse(
      data,
      data.queued
        ? `${data.queued} reminder(s) queued${data.suppressed ? `, ${data.suppressed} suppressed` : ''}`
        : (data as any).message ?? 'Nothing to send',
    );
  }

  /** Absence alerts over a register that has already been saved. */
  @Post('absence-alerts')
  @RequirePermissions('notifications.trigger')
  async absenceAlerts(
    @Body() dto: SendAbsenceAlertsDto, @CurrentUser() u: JwtPayload, @Req() req: Request,
  ) {
    const data = await this.triggers.absenceAlerts({
      schoolId: u.schoolId, classroomId: dto.classroomId, date: dto.date,
      actorUserId: u.sub, requestId: rid(req),
    });
    return successResponse(
      data,
      `${data.queued} alert(s) queued${data.suppressed ? `, ${data.suppressed} suppressed` : ''}`,
    );
  }

  /**
   * Run the outbox now instead of waiting for the next tick.
   *
   * Exists for two honest reasons: a bursar who has just sent 300 reminders
   * should not have to wait 15 seconds wondering whether anything happened,
   * and stakeholder demos of a queue are much less convincing when the queue
   * appears to do nothing for a quarter of a minute.
   */
  @Post('dispatch')
  @RequirePermissions('notifications.trigger')
  async dispatch() {
    return successResponse(await this.dispatcher.drainOnce(), 'Outbox processed');
  }
}
