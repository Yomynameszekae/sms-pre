import {
  IsUUID,
  IsOptional,
  IsString,
  IsBoolean,
} from 'class-validator';

export class CreateStudentGuardianDto {
  @IsUUID()
  studentId: string;

  @IsUUID()
  guardianId: string;

  @IsOptional()
  @IsString()
  relationship?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsBoolean()
  isEmergencyContact?: boolean;

  @IsOptional()
  @IsBoolean()
  canReceiveSms?: boolean;

  @IsOptional()
  @IsBoolean()
  canAccessPortal?: boolean;
}
