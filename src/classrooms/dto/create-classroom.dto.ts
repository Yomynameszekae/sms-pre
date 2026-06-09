import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateClassroomDto {
  @IsUUID()
  levelId: string;

  @IsUUID()
  academicYearId: string;

  @IsString()
  sectionLabel: string;

  @IsString()
  displayName: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;
}
