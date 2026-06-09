import { Module } from '@nestjs/common';
import { StudentGuardiansController } from './student-guardians.controller';
import { StudentGuardiansService } from './student-guardians.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [StudentGuardiansController],
  providers: [StudentGuardiansService],
  exports: [StudentGuardiansService],
})
export class StudentGuardiansModule {}
