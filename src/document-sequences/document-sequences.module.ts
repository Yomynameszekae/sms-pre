import { Module } from '@nestjs/common';
import { DocumentSequencesController } from './document-sequences.controller';
import { DocumentSequencesService } from './document-sequences.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [DocumentSequencesController],
  providers: [DocumentSequencesService],
  exports: [DocumentSequencesService],
})
export class DocumentSequencesModule {}
