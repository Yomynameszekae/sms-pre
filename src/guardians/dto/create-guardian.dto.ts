import {
  IsString,
  IsOptional,
  IsEmail,
} from 'class-validator';

export class CreateGuardianDto {
  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsString()
  phonePrimary: string;

  @IsOptional()
  @IsString()
  phoneSecondary?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  occupation?: string;

  @IsOptional()
  @IsString()
  address?: string;
}
