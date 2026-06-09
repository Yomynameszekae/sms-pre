import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { AdmissionStatus } from '@prisma/client';
import { CreateAdmissionDto } from './create-admission.dto';

export class UpdateAdmissionDto extends PartialType(CreateAdmissionDto) {
  @IsOptional()
  @IsString()
  admissionNumber?: string;

  @IsOptional()
  @IsEnum(AdmissionStatus)
  status?: AdmissionStatus;
}
