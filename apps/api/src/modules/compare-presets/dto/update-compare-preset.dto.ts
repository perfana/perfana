import { PartialType } from '@nestjs/swagger';
import { CreateComparePresetDto } from './create-compare-preset.dto';

export class UpdateComparePresetDto extends PartialType(CreateComparePresetDto) {}