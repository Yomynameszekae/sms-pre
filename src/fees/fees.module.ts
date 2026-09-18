import { Module } from '@nestjs/common';
import { FeesController } from './fees.controller';
import { FeeTypesService } from './fee-types.service';
import { SchoolFeesService } from './school-fees.service';
import { FeePaymentsService } from './fee-payments.service';
import { FeeAssignmentsService } from './fee-assignments.service';
import { FeesReportingService } from './fees-reporting.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [FeesController],
  providers: [
    FeeTypesService,
    SchoolFeesService,
    FeePaymentsService,
    FeeAssignmentsService,
    FeesReportingService,
  ],
  exports: [
    FeeTypesService,
    SchoolFeesService,
    FeePaymentsService,
    FeeAssignmentsService,
    FeesReportingService,
  ],
})
export class FeesModule {}
