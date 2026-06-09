import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { FileOwnerType } from '@prisma/client';

export class CreateFileDto {
  @IsEnum(FileOwnerType)
  ownerType: FileOwnerType;

  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsString()
  originalFileName: string;

  @IsOptional()
  @IsString()
  storedFileName?: string;

  @IsString()
  mimeType: string;

  /**
   * File size in bytes. Stored as BigInt in DB, but passed as a Number in the DTO.
   * JavaScript's Number is safe up to 2^53-1 which covers all practical file sizes.
   */
  @IsInt()
  @Min(1)
  sizeBytes: number;

  @IsString()
  @IsNotEmpty()
  storageBucket: string;

  @IsString()
  @IsNotEmpty()
  storageKey: string;

  @IsOptional()
  @IsString()
  checksumSha256?: string;
}
