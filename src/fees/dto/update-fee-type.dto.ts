import { PartialType } from '@nestjs/mapped-types';
import { CreateFeeTypeDto } from './create-fee-type.dto';

export class UpdateFeeTypeDto extends PartialType(CreateFeeTypeDto) {}
