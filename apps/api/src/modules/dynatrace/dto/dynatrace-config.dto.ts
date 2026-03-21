import { ApiProperty } from '@nestjs/swagger';

export class DynatraceConfigDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  host!: string;

  @ApiProperty()
  apiToken!: string;

  @ApiProperty({ enum: ['saas', 'managed'] })
  dynatraceType!: 'saas' | 'managed';

  @ApiProperty({ required: false })
  perfanaTestRunIdAttribute?: string;

  @ApiProperty({ required: false })
  perfanaRequestNameAttribute?: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}