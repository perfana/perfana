import { OrganizationRole, TeamRole } from './roles.constants';

/**
 * Canonical capability strings. Format: `<resource>:<action>` or `<resource>:<sub>:<action>`.
 * Capabilities are decoupled from roles: the role→capability mapping below is the only
 * place the policy lives. UI and services check capabilities, never roles.
 */
export const Capability = {
  // Integrations (one capability set per integration type — fine-grained for future role-shaping)
  IntegrationGrafanaCreate: 'integration:grafana:create',
  IntegrationGrafanaUpdate: 'integration:grafana:update',
  IntegrationGrafanaDelete: 'integration:grafana:delete',
  IntegrationDynatraceCreate: 'integration:dynatrace:create',
  IntegrationDynatraceUpdate: 'integration:dynatrace:update',
  IntegrationDynatraceDelete: 'integration:dynatrace:delete',
  IntegrationPyroscopeCreate: 'integration:pyroscope:create',
  IntegrationPyroscopeUpdate: 'integration:pyroscope:update',
  IntegrationPyroscopeDelete: 'integration:pyroscope:delete',
  IntegrationTracingCreate: 'integration:tracing:create',
  IntegrationTracingUpdate: 'integration:tracing:update',
  IntegrationTracingDelete: 'integration:tracing:delete',

  // Test runs
  TestRunRead: 'test-run:read',
  TestRunUpdate: 'test-run:update',
  TestRunDelete: 'test-run:delete',
  TestRunAnnotate: 'test-run:annotate',

  // Profiles, benchmarks, SUTs, dashboards
  ProfileManage: 'profile:manage',
  BenchmarkManage: 'benchmark:manage',
  SutManage: 'sut:manage',
  DashboardManage: 'dashboard:manage',

  // Organization administration
  OrgManageMembers: 'org:manage-members',
  OrgUpdate: 'org:update',
  OrgDelete: 'org:delete',
  OrgCreate: 'org:create',

  // Team administration
  TeamCreate: 'team:create',
  TeamUpdate: 'team:update',
  TeamDelete: 'team:delete',
  TeamManageMembers: 'team:manage-members',

  // API keys (org-scoped — only org-admins can issue/revoke)
  ApiKeyRead: 'api-key:read',
  ApiKeyCreate: 'api-key:create',
  ApiKeyDelete: 'api-key:delete',

  // Proxy server (org-scoped — only org-admins can configure the outbound proxy)
  ProxyManage: 'proxy:manage',

  // System-level (global admin only)
  SystemAuditRead: 'system:audit-read',
  SystemManageUsers: 'system:manage-users',
  SystemManageGlobalSettings: 'system:manage-global-settings',
} as const;

export type CapabilityValue = (typeof Capability)[keyof typeof Capability];

// org-viewer can list integrations but not mutate. No explicit "read" capability —
// listing is governed by org filtering at the service layer; the *_LIST output
// already excludes orgs the viewer doesn't belong to.
const integrationReadOnly: CapabilityValue[] = [];

const integrationCrud: CapabilityValue[] = [
  Capability.IntegrationGrafanaCreate,
  Capability.IntegrationGrafanaUpdate,
  Capability.IntegrationGrafanaDelete,
  Capability.IntegrationDynatraceCreate,
  Capability.IntegrationDynatraceUpdate,
  Capability.IntegrationDynatraceDelete,
  Capability.IntegrationPyroscopeCreate,
  Capability.IntegrationPyroscopeUpdate,
  Capability.IntegrationPyroscopeDelete,
  Capability.IntegrationTracingCreate,
  Capability.IntegrationTracingUpdate,
  Capability.IntegrationTracingDelete,
];

const testRunCrud: CapabilityValue[] = [
  Capability.TestRunRead,
  Capability.TestRunUpdate,
  Capability.TestRunAnnotate,
];

const orgAdminExtras: CapabilityValue[] = [
  Capability.OrgManageMembers,
  Capability.OrgUpdate,
  Capability.TeamCreate,
  Capability.TeamUpdate,
  Capability.TeamDelete,
  Capability.TeamManageMembers,
  Capability.ProfileManage,
  Capability.BenchmarkManage,
  Capability.SutManage,
  Capability.DashboardManage,
  Capability.TestRunDelete,
  Capability.ApiKeyRead,
  Capability.ApiKeyCreate,
  Capability.ApiKeyDelete,
  Capability.ProxyManage,
];

/**
 * Role → capability mapping.
 * Each role grants the union of its mapped capabilities.
 *
 * The type constraint ensures every role enum value has an entry (compile error
 * if a role is missed) and that array entries are valid CapabilityValue references
 * (compile error on a typo like 'integration:dynatrce:updte').
 */
type CapabilitySet = readonly CapabilityValue[];
type RoleCapabilityMap = {
  organization: Record<OrganizationRole, CapabilitySet>;
  team: Record<TeamRole, CapabilitySet>;
};

export const ROLE_CAPABILITIES: RoleCapabilityMap = {
  organization: {
    [OrganizationRole.ADMIN]: [
      ...integrationCrud,
      ...testRunCrud,
      ...orgAdminExtras,
    ],
    [OrganizationRole.MEMBER]: [
      ...testRunCrud,
      Capability.ProfileManage,
      Capability.BenchmarkManage,
      Capability.SutManage,
      Capability.DashboardManage,
      Capability.ApiKeyRead,
    ],
    [OrganizationRole.VIEWER]: [
      ...integrationReadOnly,
      Capability.TestRunRead,
      Capability.ApiKeyRead,
    ],
  },
  team: {
    [TeamRole.ADMIN]: [
      Capability.TeamUpdate,
      Capability.TeamManageMembers,
    ],
    [TeamRole.MEMBER]: [],
    [TeamRole.VIEWER]: [],
  },
} as const;

/**
 * Global admins (system-roles `perfana-admin` / `admin`) get every capability.
 * Computed at module load — no need to enumerate again here, the service expands it.
 */
export const GLOBAL_ADMIN_CAPABILITIES: CapabilityValue[] =
  Object.values(Capability);
