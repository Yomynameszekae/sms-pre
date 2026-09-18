import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsString } from 'class-validator';
import { CreateAdmissionDto } from './create-admission.dto';

// NOTE: `status` is deliberately ABSENT. Status only moves through the
// dedicated transition endpoints (apply/offer/revert-offer/reject/withdraw/
// enroll/revert-enrollment), each with validation, cleanup, and an audit
// entry. A writable status field here would bypass the state machine —
// which is exactly what happened before Phase 1B.
export class UpdateAdmissionDto extends PartialType(CreateAdmissionDto) {
  @IsOptional()
  @IsString()
  admissionNumber?: string;
}
