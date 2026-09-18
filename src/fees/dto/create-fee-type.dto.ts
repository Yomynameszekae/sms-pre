import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateFeeTypeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** Optional `Label` of category `fee` — validated in the service. */
  @IsOptional()
  @IsUUID()
  labelId?: string;
}
