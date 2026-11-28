export interface DynatraceConfig {
  id: string;
  host: string;
  apiToken: string;
  dynatraceType: 'saas' | 'managed';
  label: string;
  platformApiToken?: string;
  perfanaTestRunIdAttribute?: string;
  perfanaRequestNameAttribute?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DynatraceEntity {
  entityId: string;
  displayName: string;
  entityType: string;
  tags?: Array<{
    key: string;
    value?: string;
    // 'CONTEXTLESS' for manual/auto tags; otherwise the source ('ENVIRONMENT',
    // 'AWS', 'KUBERNETES', ...). A context tag only matches tag("[context]key").
    context?: string;
  }>;
}

/**
 * The tag key as Dynatrace's entitySelector needs it: a context tag is only
 * matched by tag("[CONTEXT]key"), never by its bare key — the bare key returns
 * zero entities.
 */
export const selectorTagKey = (t: { key: string; context?: string }): string =>
  t.context && t.context !== 'CONTEXTLESS' ? `[${t.context}]${t.key}` : t.key;

export interface DynatraceEntityMapping {
  id: string;
  dynatraceConfigId: string;
  dynatraceLabel?: string;
  systemUnderTestId: string;
  testEnvironment?: string;
  workload?: string;
  entityId: string;
  entityDisplayName: string;
  entityType: string;
  level: EntityMappingLevel;
  /** Free-form role labels ("appserver", "database", …). Presentation only. */
  labels?: string[];
  organizationId?: string;
  /**
   * Per-resource capability hint from the API. The backend 403s a non-admin on
   * DELETE; without this the button looks live and the user only finds out by
   * clicking. Fed straight to <RequiresPermission resourcePermissions=...>.
   */
  _permissions?: { update: boolean; delete: boolean };
  createdAt: string;
  updatedAt: string;
}

export type EntityMappingLevel = 'sut' | 'sut_testenv' | 'sut_testenv_workload';

export interface DynatraceDeeplinkSectionProps {
  systemId: string;
  systemName: string;
  selectedEnvironment: string;
  selectedWorkload: string;
  // Called after host mappings are added — adding a HOST auto-creates metric
  // queries server-side, so the Queries tab needs to refetch to show them.
  onHostQueriesCreated?: () => void;
}

export interface EntityTypeOption {
  value: string;
  label: string;
}

export interface AddEntityDialogState {
  selectedLevel: EntityMappingLevel;
  selectedEntityType: string;
  selectedEntity: DynatraceEntity | null;
  searchInput: string;
}
