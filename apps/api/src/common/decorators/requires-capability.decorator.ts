import { SetMetadata } from '@nestjs/common';
import { CapabilityValue } from '../../constants/capabilities.constants';

export const REQUIRES_CAPABILITY_META = 'requires_capability';

export interface OrgIdSource {
  /** Resolve org ID from req.params[orgIdParam] */
  orgIdParam?: string;
  /** Resolve org ID from req.body[orgIdFromBody] */
  orgIdFromBody?: string;
  /** Resolve org ID from req.query[orgIdFromQuery] */
  orgIdFromQuery?: string;
}

export interface RequiresCapabilityMeta {
  capability: CapabilityValue;
  source: OrgIdSource;
}

/**
 * Method decorator that gates the route behind a capability check.
 *
 * The paired `CapabilityGuard` reads this metadata, resolves the org ID from
 * the request (via the configured source), calls
 * `AuthorizationService.getCapabilities(userId, roles, orgId)`, and throws
 * `ForbiddenException` if the capability is absent.
 *
 * @example
 * // Resolve org from a body field:
 * @Post()
 * @RequiresCapability(Capability.IntegrationDynatraceCreate, { orgIdFromBody: 'organizationId' })
 * async create(@Body() dto: CreateDto) { ... }
 *
 * @example
 * // Resolve org from a route param:
 * @Patch(':id')
 * @RequiresCapability(Capability.IntegrationDynatraceUpdate, { orgIdParam: 'id' })
 * async update(@Param('id') id: string) { ... }
 *
 * @example
 * // System-level capability (no org scope):
 * @Post('admin/something')
 * @RequiresCapability(Capability.SystemManageUsers)
 * async adminOp() { ... }
 */
export const RequiresCapability = (
  capability: CapabilityValue,
  source: OrgIdSource = {},
) =>
  SetMetadata(REQUIRES_CAPABILITY_META, {
    capability,
    source,
  } satisfies RequiresCapabilityMeta);
