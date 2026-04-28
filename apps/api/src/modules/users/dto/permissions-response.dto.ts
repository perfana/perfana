import { ApiProperty } from '@nestjs/swagger';
import { CapabilityValue } from '../../../constants/capabilities.constants';

export class PermissionsResponseDto {
  @ApiProperty({ description: 'Authenticated user ID (Keycloak sub or api-key:{id})' })
  userId!: string;

  @ApiProperty({
    description: 'Capability strings the user has globally (independent of org context)',
    type: [String],
  })
  global!: CapabilityValue[];

  @ApiProperty({
    description: 'Capability strings per accessible organization, keyed by organizationId',
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'string' } },
  })
  byOrg!: Record<string, CapabilityValue[]>;
}
