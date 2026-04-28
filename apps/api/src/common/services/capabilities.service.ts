import { Injectable } from '@nestjs/common';
import {
  CapabilityValue,
  GLOBAL_ADMIN_CAPABILITIES,
  ROLE_CAPABILITIES,
} from '../../constants/capabilities.constants';
import {
  GLOBAL_ADMIN_ROLES,
  OrganizationRole,
  TeamRole,
} from '../../constants/roles.constants';

export interface CapabilityInput {
  /** System-level roles from the JWT (Keycloak `realm_access.roles`). */
  systemRoles: string[];
  /** Organization-level roles for the *currently-scoped* organization. Empty if none. */
  orgRoles: OrganizationRole[];
  /** Team-level roles for the *currently-scoped* team. Empty if none. */
  teamRoles: TeamRole[];
}

/**
 * Pure mapping from (systemRoles, orgRoles, teamRoles) to a capability set.
 * Stateless. No I/O. Easy to test exhaustively.
 *
 * Loading the role data is the AuthorizationService's job; this service only
 * does the mapping math.
 */
@Injectable()
export class CapabilitiesService {
  compute(input: CapabilityInput): CapabilityValue[] {
    const caps = new Set<CapabilityValue>();

    if (input.systemRoles.some((r) => (GLOBAL_ADMIN_ROLES as readonly string[]).includes(r))) {
      for (const c of GLOBAL_ADMIN_CAPABILITIES) caps.add(c);
      return Array.from(caps);
    }

    for (const role of input.orgRoles) {
      for (const c of ROLE_CAPABILITIES.organization[role] ?? []) caps.add(c);
    }
    for (const role of input.teamRoles) {
      for (const c of ROLE_CAPABILITIES.team[role] ?? []) caps.add(c);
    }

    return Array.from(caps);
  }
}
