import { IsString, MinLength } from 'class-validator';

export class AccountSetupConfirmDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}
