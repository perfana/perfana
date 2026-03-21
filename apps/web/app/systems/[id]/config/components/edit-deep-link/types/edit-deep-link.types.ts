/**
 * Types and constants for EditDeepLinkDialog component
 */

export interface DeepLink {
  id: string;
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
  name: string;
  url: string;
  tags: string[];
  templateDeepLinkId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeepLinkFormData {
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
  name: string;
  url: string;
  tags: string[];
}

export interface EditDeepLinkDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (id: string, deepLink: DeepLinkFormData) => Promise<void>;
  deepLink: DeepLink | null;
  systemName: string;
  loading: boolean;
}

export interface VariableDefinition {
  name: string;
  description: string;
}

/**
 * Base variables available for all deep links
 */
export const BASE_VARIABLES: VariableDefinition[] = [
  { name: 'perfana-system-under-test', description: 'System under test ID' },
  { name: 'perfana-test-environment', description: 'Test environment name' },
  { name: 'perfana-workload', description: 'Workload name' },
  { name: 'perfana-test-run-id', description: 'Test run identifier' },
  { name: 'perfana-build-result-url', description: 'CI/CD build results URL' },
  { name: 'perfana-start-epoch-milliseconds', description: 'Test start time (epoch ms)' },
  { name: 'perfana-start-epoch-seconds', description: 'Test start time (epoch seconds)' },
  { name: 'perfana-end-epoch-milliseconds', description: 'Test end time (epoch ms)' },
  { name: 'perfana-end-epoch-seconds', description: 'Test end time (epoch seconds)' },
  { name: 'perfana-start-dynatrace', description: 'Test start time (Dynatrace format)' },
  { name: 'perfana-end-dynatrace', description: 'Test end time (Dynatrace format)' },
  { name: 'perfana-start-elasticsearch', description: 'Test start time (Elasticsearch format)' },
  { name: 'perfana-end-elasticsearch', description: 'Test end time (Elasticsearch format)' },
  { name: 'perfana-previous-test-run-id', description: 'Previous test run ID for comparison' },
];

/**
 * Example URLs for the helper section
 */
export const URL_EXAMPLES = [
  {
    label: 'Grafana',
    template: 'https://grafana.com/d/my-dash?from={perfana-start-epoch-milliseconds}&to={perfana-end-epoch-milliseconds}',
  },
  {
    label: 'Dynatrace',
    template: 'https://tenant.live.dynatrace.com/ui/problems?gtf={perfana-start-dynatrace}_{perfana-end-dynatrace}',
  },
  {
    label: 'Jenkins',
    template: '{perfana-build-result-url}/console',
  },
];

export interface AutocompleteState {
  open: boolean;
  anchor: HTMLElement | null;
  filteredVariables: VariableDefinition[];
  cursorPosition: number;
  selectedIndex: number;
  hoveredIndex: number | null;
}
