import { IsOptional, IsString } from 'class-validator';

export class OfferAdmissionDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
