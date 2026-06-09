import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateSequenceDto {
  @IsOptional()
  @IsString()
  prefix?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  paddingLength?: number;

  @IsOptional()
  @IsString()
  resetPolicy?: string;
}
