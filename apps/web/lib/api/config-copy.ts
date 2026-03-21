import { authenticatedFetch } from '../api';

export interface CopyConfigParams {
  sourceSystemUnderTestId: string;
  sourceTestEnvironment: string;
  sourceWorkload: string;
  targetSystemUnderTestId: string;
  targetTestEnvironment: string;
  targetWorkload: string;
  conflictStrategy: 'skip' | 'overwrite';
  ids?: string[];
}

export interface CopyDashboardParams {
  sourceSystemUnderTestId: string;
  sourceTestEnvironment: string;
  targetSystemUnderTestId: string;
  targetTestEnvironment: string;
  conflictStrategy: 'skip' | 'overwrite';
  ids?: string[];
}

export interface CopyReportTemplateParams {
  sourceSystemId: string;
  sourceTestEnvironment: string;
  sourceWorkload: string;
  targetSystemId: string;
  targetTestEnvironment: string;
  targetWorkload: string;
  conflictStrategy: 'skip' | 'overwrite';
  ids?: string[];
}

export interface CopyResult {
  copied: number;
  skipped: number;
  total: number;
}

/**
 * Copy deep links from one scope to another.
 */
export async function copyDeepLinks(params: CopyConfigParams): Promise<CopyResult> {
  const response = await authenticatedFetch('/deep-links/copy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error((data as { message?: string }).message || 'Failed to copy deep links');
  }
  return response.json();
}

/**
 * Copy SLO benchmarks from one scope to another.
 */
export async function copyBenchmarks(params: CopyConfigParams): Promise<CopyResult> {
  const response = await authenticatedFetch('/benchmarks/copy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error((data as { message?: string }).message || 'Failed to copy SLOs');
  }
  return response.json();
}

/**
 * Copy application dashboards from one scope to another.
 */
export async function copyDashboards(params: CopyDashboardParams): Promise<CopyResult> {
  const response = await authenticatedFetch('/grafana/application-dashboards/copy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error((data as { message?: string }).message || 'Failed to copy dashboards');
  }
  return response.json();
}

/**
 * Copy report templates from one scope to another.
 */
export async function copyReportTemplates(params: CopyReportTemplateParams): Promise<CopyResult> {
  const response = await authenticatedFetch('/report-templates/copy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error((data as { message?: string }).message || 'Failed to copy report templates');
  }
  return response.json();
}
