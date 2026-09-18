import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsLogService } from './notifications.log.service';
import { NotificationsTriggers } from './notifications.triggers';
import { NotificationsDispatcher } from './notifications.dispatcher';
import { LoggingSmsGateway } from './gateways/logging-sms.gateway';
import { SMS_GATEWAY } from './gateways/sms-gateway.interface';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

/**
 * ONE binding to SMS_GATEWAY. Swapping vendors changes this line and adds one
 * file; nothing in the service, the poller, the triggers or the frontend
 * knows which gateway is behind it.
 *
 * Selection will become a `SchoolSetting` read (`notifications.sms.gateway`)
 * with credentials from environment config — the same shape as
 * `files.default_storage_bucket` — the moment there is a second adapter to
 * choose between. With one adapter, a factory would be indirection with
 * nothing on the other side of it.
 *
 * `@Global` because the triggers are consumed by Fees, Attendance and Auth,
 * and threading the module through each of their imports adds nothing.
 */
@Global()
@Module({
  imports: [ScheduleModule.forRoot(), AuditLogsModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsLogService,
    NotificationsTriggers,
    NotificationsDispatcher,
    { provide: SMS_GATEWAY, useClass: LoggingSmsGateway },
  ],
  exports: [NotificationsService, NotificationsTriggers, NotificationsLogService],
})
export class NotificationsModule {}
