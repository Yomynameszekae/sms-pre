import { IsEmail, IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export enum LinkedEntityType {
  STAFF = 'staff',
  GUARDIAN = 'guardian',
}

export class CreateUserDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsEnum(LinkedEntityType)
  linkedEntityType: LinkedEntityType;

  @IsUUID()
  linkedEntityId: string;
}
