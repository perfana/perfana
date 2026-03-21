/**
 * Distributed tracing configuration types
 */

import { TracingService, TracingInstance } from '@/lib/distributed-tracing';

// Re-export for convenience
export type { TracingService, TracingInstance };

/**
 * Configuration level for tracing services
 */
export type ConfigLevel = 'system' | 'environment' | 'workload';

/**
 * Props for the DistributedTracingSection component
 */
export interface DistributedTracingSectionProps {
  systemId: string;
  systemName: string;
  selectedEnvironment: string;
  selectedWorkload: string;
}

/**
 * Form data for creating/editing a tracing service
 */
export interface TracingServiceFormData {
  level: ConfigLevel;
  environment: string;
  workload: string;
  tracing_instance_id: string;
  service_names: string[];
}

/**
 * Initial form data for a new tracing service
 */
export const INITIAL_FORM_DATA: TracingServiceFormData = {
  level: 'system',
  environment: '',
  workload: '',
  tracing_instance_id: '',
  service_names: [],
};

/**
 * Snackbar notification state
 */
export interface SnackbarState {
  open: boolean;
  message: string;
  severity: 'success' | 'error';
}

/**
 * Props for the useDistributedTracingData hook
 */
export interface UseDistributedTracingDataProps {
  systemId: string;
  onSnackbar: (state: SnackbarState) => void;
}

/**
 * Get display label for config level based on service configuration
 */
export function getConfigLevelLabel(service: TracingService): string {
  if (service.workload) return 'Workload';
  if (service.testEnvironment) return 'Environment';
  return 'System';
}

/**
 * Get badge color for tracing UI type
 */
export function getUiTypeBadgeColor(
  uiType: string
): 'primary' | 'secondary' | 'success' | 'default' {
  switch (uiType) {
    case 'tempo':
      return 'primary';
    case 'jaeger':
      return 'secondary';
    case 'elastic':
      return 'success';
    default:
      return 'default';
  }
}

/**
 * Convert TracingService to form data for editing
 */
export function serviceToFormData(service: TracingService): TracingServiceFormData {
  return {
    level: service.workload
      ? 'workload'
      : service.testEnvironment
        ? 'environment'
        : 'system',
    environment: service.testEnvironment || '',
    workload: service.workload || '',
    tracing_instance_id: service.tracingInstanceId,
    service_names: service.serviceNames,
  };
}

/**
 * Convert form data to API payload
 */
export function formDataToPayload(
  formData: TracingServiceFormData,
  systemId: string
): Record<string, unknown> {
  return {
    systemUnderTestId: systemId,
    testEnvironment: formData.level !== 'system' ? formData.environment : undefined,
    workload: formData.level === 'workload' ? formData.workload : undefined,
    tracingInstanceId: formData.tracing_instance_id,
    serviceNames: formData.service_names,
  };
}
