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
  /** Example of the resolved value, shown in the variable dropdown */
  example?: string;
}

/**
 * Base variables available for all deep links.
 *
 * Timestamp variables are named after the official datetime format they
 * produce (Unix epoch, ISO 8601) — not after tools. The legacy tool-named
 * variables ({perfana-start-dynatrace}, {perfana-start-elasticsearch}, …)
 * still resolve in the API for previously saved deep links, but are no
 * longer offered here.
 */
export const BASE_VARIABLES: VariableDefinition[] = [
  { name: 'perfana-system-under-test', description: 'System under test ID', example: 'MyAfterburner' },
  { name: 'perfana-test-environment', description: 'Test environment name', example: 'acceptance' },
  { name: 'perfana-workload', description: 'Workload name', example: 'loadTest' },
  { name: 'perfana-test-run-id', description: 'Test run identifier', example: 'MyAfterburner-acceptance-loadTest-00001' },
  { name: 'perfana-build-result-url', description: 'CI/CD build results URL', example: 'https://ci.example.com/job/123' },
  { name: 'perfana-start-epoch-milliseconds', description: 'Test start — Unix epoch, milliseconds', example: '1783976460000' },
  { name: 'perfana-start-epoch-seconds', description: 'Test start — Unix epoch, seconds', example: '1783976460' },
  { name: 'perfana-end-epoch-milliseconds', description: 'Test end — Unix epoch, milliseconds', example: '1783978260000' },
  { name: 'perfana-end-epoch-seconds', description: 'Test end — Unix epoch, seconds', example: '1783978260' },
  { name: 'perfana-start-iso8601-utc', description: 'Test start — ISO 8601, UTC', example: '2026-07-09T19:01:00.000Z' },
  { name: 'perfana-end-iso8601-utc', description: 'Test end — ISO 8601, UTC', example: '2026-07-09T19:31:00.000Z' },
  { name: 'perfana-start-iso8601-offset', description: 'Test start — ISO 8601 with UTC offset, URL-encoded', example: '2026-07-09T21:01:00%2B02:00' },
  { name: 'perfana-end-iso8601-offset', description: 'Test end — ISO 8601 with UTC offset, URL-encoded', example: '2026-07-09T21:31:00%2B02:00' },
  { name: 'perfana-previous-test-run-id', description: 'Previous test run ID for comparison', example: 'MyAfterburner-acceptance-loadTest-00000' },
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
    template: 'https://tenant.live.dynatrace.com/ui/problems?gtf={perfana-start-iso8601-offset}_{perfana-end-iso8601-offset}',
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
