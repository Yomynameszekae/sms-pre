import { IsString, MaxLength, MinLength } from 'class-validator';

export class RevokeConsentDto {
  @IsString()
  @MinLength(5, { message: 'Give a short reason — it goes into the audit trail' })
  @MaxLength(255)
  reason: string;
}
