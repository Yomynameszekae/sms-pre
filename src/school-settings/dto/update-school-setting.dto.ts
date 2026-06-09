import { IsNotEmpty } from 'class-validator';

export class UpdateSchoolSettingDto {
  @IsNotEmpty()
  valueJson: any;
}
