import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { LevelGroup } from '@prisma/client';

export class CreateLevelDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  gesDesignation?: string;

  @IsOptional()
  @IsString()
  abekaDesignation?: string;

  @IsInt()
  @Min(1)
  orderIndex: number;

  @IsEnum(LevelGroup)
  levelGroup: LevelGroup;
}
