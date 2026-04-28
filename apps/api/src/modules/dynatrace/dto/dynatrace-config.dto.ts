import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PermissionsMap } from '../../../common/serializers/with-permissions.serializer';

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

  @ApiPropertyOptional({
    description:
      'Per-resource permissions for the requesting user. Frontend gates UI actions on these booleans ' +
      '(capability + legacy-null-org rules already applied server-side).',
    type: 'object',
    additionalProperties: { type: 'boolean' },
    example: { update: true, delete: true },
  })
  _permissions?: PermissionsMap;
}