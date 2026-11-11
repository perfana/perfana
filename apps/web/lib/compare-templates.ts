import { authenticatedFetch } from './api';
import { serverErrorMessage } from './errors';

/**
 * Compare-config (ADAPT) templates: `/compare-templates` (organization and install-wide),
 * `/profiles/:id/compare-templates` (a profile's) and the YAML export.
 * File format, precedence and ownership: docs/reference/Features/Compare Config Templates.md.
 */

/**
 * Which collection a page addresses: a profile's templates (runs whose tags match it), an
 * organization's, or the install-wide ones.
 */
export type CompareTemplateScope =
  | { kind: 'install' }
  | { kind: 'organization'; organizationId: string }
  | { kind: 'profile'; profileId: string };

export type CompareTemplateScopeKind = CompareTemplateScope['kind'];

/**
 * One template, in the shape of an item of `template_ds_compare_configs.yaml`. Presence matters: a
 * key that is present forces that value onto every row the template reaches, an absent key leaves
 * each row's own value alone. `null` is meaningful only for `higherIsBetter` ("no direction") and
 * `absThreshold` ("no absolute threshold"); every other field is omitted, never sent as `null`.
 */
export interface CompareTemplateDefinition {
  dashboardUid?: string;
  regex?: boolean;
  dashboardLabel?: string;
  panelId?: number;
  panelTitle?: string;
  metricName?: string;
  metricClassification: string;
  higherIsBetter?: boolean | null;
  absThreshold?: number | null;
  ignore?: boolean;
  /** A fraction, as stored: 0.15 is 15 %. */
  percentageThreshold?: number;
  iqrThreshold?: number;
  aggregation?: string;
  minSampleCount?: number;
  defaultValueIfControlGroupMissing?: number;
}

export interface CompareTemplate {
  id: string;
  scope: CompareTemplateScopeKind;
  /** A profile template's is its profile's. */
  organizationId: string | null;
  profileId?: string | null;
  profileName?: string | null;
  /** Provisioned from template_ds_compare_configs.yaml: edit the file, not the template. */
  readOnly: boolean;
  definition: CompareTemplateDefinition;
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CompareTemplateList {
  scope: CompareTemplateScopeKind;
  organizationId: string | null;
  profileId?: string | null;
  profileName?: string | null;
  /** Whether the caller may create, edit and delete templates in this scope. */
  canWrite: boolean;
  /** In the order the YAML export writes them. */
  templates: CompareTemplate[];
}

/** The query naming an organization or the install-wide scope on `/compare-templates`. */
export function scopeQuery(scope: Exclude<CompareTemplateScope, { kind: 'profile' }>): string {
  return scope.kind === 'install'
    ? 'scope=install'
    : `organizationId=${encodeURIComponent(scope.organizationId)}`;
}

/** The collection's API path: a profile's templates live under the profile, like its SLOs. */
export function collectionPath(scope: CompareTemplateScope): string {
  return scope.kind === 'profile'
    ? `/profiles/${encodeURIComponent(scope.profileId)}/compare-templates`
    : `/compare-templates?${scopeQuery(scope)}`;
}

/** The scope as the page URL carries it: `?scope=install` or `?organizationId=<uuid>`. */
export function parseScopeParams(params: { get(name: string): string | null }): CompareTemplateScope | null {
  const organizationId = params.get('organizationId');
  if (params.get('scope') === 'install' && !organizationId) return { kind: 'install' };
  if (organizationId) return { kind: 'organization', organizationId };
  return null;
}

/** Where a scope's templates are managed: a profile's on its own page, the others on the templates page. */
export function templatesPageHref(scope: CompareTemplateScope): string {
  return scope.kind === 'profile'
    ? `/settings/profiles/${encodeURIComponent(scope.profileId)}?tab=adapt-templates`
    : `/settings/profiles/adapt-templates?${scopeQuery(scope)}`;
}

export async function fetchCompareTemplates(scope: CompareTemplateScope): Promise<CompareTemplateList> {
  const response = await authenticatedFetch(collectionPath(scope), { cache: 'no-store' });
  if (!response.ok) throw new Error(await serverErrorMessage(response, 'Failed to load ADAPT templates'));
  return response.json();
}

export async function createCompareTemplate(
  scope: CompareTemplateScope,
  definition: CompareTemplateDefinition,
): Promise<CompareTemplate> {
  const response = await authenticatedFetch(collectionPath(scope), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(definition),
  });
  if (!response.ok) throw new Error(await serverErrorMessage(response, 'Failed to create the ADAPT template'));
  return response.json();
}

/**
 * Replaces the whole definition: a field left out stops being forced. `/compare-templates/:id` serves
 * every scope, a profile's templates included.
 */
export async function updateCompareTemplate(id: string, definition: CompareTemplateDefinition): Promise<CompareTemplate> {
  const response = await authenticatedFetch(`/compare-templates/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(definition),
  });
  if (!response.ok) throw new Error(await serverErrorMessage(response, 'Failed to save the ADAPT template'));
  return response.json();
}

export async function deleteCompareTemplate(id: string): Promise<void> {
  const response = await authenticatedFetch(`/compare-templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(await serverErrorMessage(response, 'Failed to delete the ADAPT template'));
}

/** The install's whole `template_ds_compare_configs.yaml` (global admin). */
export async function exportCompareTemplatesYaml(): Promise<string> {
  const response = await authenticatedFetch('/provisioning/compare-templates/export', { cache: 'no-store' });
  if (!response.ok) throw new Error(await serverErrorMessage(response, 'Failed to export the templates file'));
  return response.text();
}
