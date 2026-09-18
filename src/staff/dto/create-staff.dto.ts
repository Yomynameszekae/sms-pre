import {
  IsString,
  IsOptional,
  IsEmail,
  IsEnum,
  IsDateString,
} from 'class-validator';
import {
  StaffRoleCategory,
  EmploymentType,
  NtcStatus,
} from '@prisma/client';

export class CreateStaffDto {
  // Optional: left blank, the service auto-generates the next number from the
  // school's staff_number document sequence.
  @IsOptional()
  @IsString()
  staffNumber?: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsEnum(StaffRoleCategory)
  roleCategory: StaffRoleCategory;

  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @IsOptional()
  @IsString()
  ntcRegistrationNumber?: string;

  @IsOptional()
  @IsEnum(NtcStatus)
  ntcStatus?: NtcStatus;

  @IsOptional()
  @IsDateString()
  joinedAt?: string;
}
