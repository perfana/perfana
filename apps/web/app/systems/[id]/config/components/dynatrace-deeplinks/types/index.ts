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
  }>;
}

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
  createdAt: string;
  updatedAt: string;
}

export type EntityMappingLevel = 'sut' | 'sut_testenv' | 'sut_testenv_workload';

export interface DynatraceDeeplinkSectionProps {
  systemId: string;
  systemName: string;
  selectedEnvironment: string;
  selectedWorkload: string;
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
