// Confluence publishing API client. Docs: docs/reference/Features/Confluence Publishing.md

import { authenticatedFetch } from './api';

export const CONFLUENCE_MASK = '[MASKED]';

export type ConfluenceDeployment = 'cloud' | 'datacenter';

export interface ConfluenceConfig {
  id: string;
  label: string;
  baseUrl: string;
  deployment: ConfluenceDeployment;
  username: string | null;
  /** Always '[MASKED]'. Send the mask back unchanged to keep the stored token. */
  apiToken: string;
  spaceKey: string;
  parentPageId: string | null;
  useProxy: boolean;
  organizationId: string;
}

export type ConfluenceConfigInput = Omit<ConfluenceConfig, 'id' | 'organizationId'> & { organizationId?: string };

export interface ConfluencePublication {
  pageId: string;
  url: string;
  publishedAt: string;
  charts: number;
}

/** The API's own message (a 400 carries Confluence's reason), falling back to the status text. */
async function errorOf(res: Response, fallback: string): Promise<Error> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    const msg = Array.isArray(body.message) ? body.message.join('; ') : body.message;
    return new Error(msg || `${fallback}: ${res.statusText}`);
  } catch {
    return new Error(`${fallback}: ${res.statusText}`);
  }
}

async function call<T>(url: string, fallback: string, init: RequestInit = {}): Promise<T> {
  const res = await authenticatedFetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) throw await errorOf(res, fallback);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

/** A stored page URL as an href, or undefined when it is not plain http(s). Defense in depth: the API already pins it. */
export function safeConfluenceHref(url: string | null | undefined): string | undefined {
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}

export const fetchConfluenceConfigs = (organizationId?: string | null) =>
  call<ConfluenceConfig[]>(
    `/confluence/configs${organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : ''}`,
    'Failed to fetch Confluence connections',
  );

export const createConfluenceConfig = (input: ConfluenceConfigInput) =>
  call<ConfluenceConfig>('/confluence/configs', 'Failed to create the Confluence connection', { method: 'POST', ...json(input) });

export const updateConfluenceConfig = (id: string, input: Partial<ConfluenceConfigInput>) =>
  call<ConfluenceConfig>(`/confluence/configs/${id}`, 'Failed to update the Confluence connection', { method: 'PATCH', ...json(input) });

export const deleteConfluenceConfig = (id: string) =>
  call<void>(`/confluence/configs/${id}`, 'Failed to delete the Confluence connection', { method: 'DELETE' });

export const testConfluenceConnection = (input: Omit<ConfluenceConfigInput, 'label' | 'parentPageId'>) =>
  call<{ success: boolean; message: string }>('/confluence/configs/test-connection', 'Connection test failed', { method: 'POST', ...json(input) });

export const testSavedConfluenceConnection = (id: string) =>
  call<{ success: boolean; message: string }>(`/confluence/configs/${id}/test-connection`, 'Connection test failed', { method: 'POST' });

export const publishReportToConfluence = (reportId: string, configId: string, title?: string) =>
  call<ConfluencePublication>(`/confluence/reports/${reportId}/publish`, 'Publishing to Confluence failed', {
    method: 'POST',
    ...json({ configId, ...(title?.trim() ? { title: title.trim() } : {}) }),
  });
