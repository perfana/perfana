import { EntityMappingLevel, EntityTypeOption } from '../types';

/**
 * Available Dynatrace entity types for mapping configuration
 */
export const ENTITY_TYPES: EntityTypeOption[] = [
  { value: 'HOST', label: 'Host' },
  { value: 'SERVICE', label: 'Service' },
  { value: 'PROCESS_GROUP', label: 'Process Group' },
  { value: 'APPLICATION', label: 'Application' },
  { value: 'CONTAINER_GROUP', label: 'Container Group' },
  { value: 'KUBERNETES_CLUSTER', label: 'Kubernetes Cluster' },
  { value: 'KUBERNETES_NODE', label: 'Kubernetes Node' },
  { value: 'DATABASE', label: 'Database' },
];

/**
 * Get the display name for an entity mapping level
 */
export function getLevelDisplayName(level: EntityMappingLevel | string): string {
  switch (level) {
    case 'sut':
      return 'System under test';
    case 'sut_testenv':
      return 'Test environment';
    case 'sut_testenv_workload':
      return 'Workload';
    default:
      return level;
  }
}

/**
 * Get the color for an entity mapping level chip
 */
export function getLevelColor(level: EntityMappingLevel | string): 'primary' | 'secondary' | 'success' | 'default' {
  switch (level) {
    case 'sut':
      return 'primary';
    case 'sut_testenv':
      return 'secondary';
    case 'sut_testenv_workload':
      return 'success';
    default:
      return 'default';
  }
}

/**
 * Filter entity mappings based on the current context (environment and workload)
 */
export function filterMappingsByContext(
  mappings: Array<{ level: EntityMappingLevel; testEnvironment?: string; workload?: string }>,
  selectedEnvironment: string,
  selectedWorkload: string
): typeof mappings {
  return mappings.filter(mapping => {
    switch (mapping.level) {
      case 'sut':
        return true; // Show all system-level mappings
      case 'sut_testenv':
        return mapping.testEnvironment === selectedEnvironment;
      case 'sut_testenv_workload':
        return mapping.testEnvironment === selectedEnvironment && mapping.workload === selectedWorkload;
      default:
        return false;
    }
  });
}
