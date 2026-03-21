import { PartialType } from '@nestjs/swagger';
import { CreateDynatraceQueryDto } from './create-dynatrace-query.dto';

export class UpdateDynatraceQueryDto extends PartialType(CreateDynatraceQueryDto) {}