/**
 * The ADAPT templates client goes through authenticatedFetch (apps/web/CLAUDE.md), addresses a
 * collection by scope, and surfaces the server's own words on a refusal: a 409 naming the
 * conflicting template is the whole value of the response.
 */
jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
import { authenticatedFetch } from '@/lib/api';
import {
  createCompareTemplate,
  deleteCompareTemplate,
  exportCompareTemplatesYaml,
  fetchCompareTemplates,
  parseScopeParams,
  templatesPageHref,
  updateCompareTemplate,
} from '../compare-templates';

const fetchMock = authenticatedFetch as jest.Mock;
const ok = (body: unknown, text?: string) => ({ ok: true, status: 200, json: async () => body, text: async () => text ?? '' });
const refused = (status: number, message: string) => ({ ok: false, status, json: async () => ({ message }) });

const ORG = 'aaaaaaaa-0000-4000-8000-00000000000a';

beforeEach(() => fetchMock.mockReset());

it('reads the scope from the page URL, and refuses a URL without one', () => {
  expect(parseScopeParams(new URLSearchParams('scope=install'))).toEqual({ kind: 'install' });
  expect(parseScopeParams(new URLSearchParams(`organizationId=${ORG}`))).toEqual({ kind: 'organization', organizationId: ORG });
  expect(parseScopeParams(new URLSearchParams(''))).toBeNull();
  expect(templatesPageHref({ kind: 'organization', organizationId: ORG })).toBe(`/settings/profiles/adapt-templates?organizationId=${ORG}`);
});

it('lists one scope', async () => {
  fetchMock.mockResolvedValue(ok({ templates: [] }));
  await fetchCompareTemplates({ kind: 'install' });
  expect(fetchMock).toHaveBeenCalledWith('/compare-templates?scope=install', { cache: 'no-store' });
});

it('creates in the scope it names, with the definition as the body', async () => {
  fetchMock.mockResolvedValue(ok({ id: 't' }));
  await createCompareTemplate({ kind: 'organization', organizationId: ORG }, { panelId: 1, metricClassification: 'x', higherIsBetter: null });
  expect(fetchMock).toHaveBeenCalledWith(`/compare-templates?organizationId=${ORG}`, expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({ panelId: 1, metricClassification: 'x', higherIsBetter: null }),
  }));
});

it("surfaces the server's message on a refusal", async () => {
  fetchMock.mockResolvedValue(refused(409, 'There is already a template for every dashboard, panel 1 in organization "Acme".'));
  await expect(createCompareTemplate({ kind: 'install' }, { panelId: 1, metricClassification: 'x' })).rejects.toThrow(
    'There is already a template for every dashboard, panel 1 in organization "Acme".',
  );
  fetchMock.mockResolvedValue(refused(409, 'This template is provisioned'));
  await expect(updateCompareTemplate('t', { panelId: 1, metricClassification: 'x' })).rejects.toThrow('This template is provisioned');
  fetchMock.mockResolvedValue(refused(403, 'Forbidden'));
  await expect(deleteCompareTemplate('t')).rejects.toThrow('Forbidden');
});

it('replaces by id and deletes by id', async () => {
  fetchMock.mockResolvedValue(ok({}));
  await updateCompareTemplate('t 1', { panelId: 1, metricClassification: 'x' });
  expect(fetchMock).toHaveBeenLastCalledWith('/compare-templates/t%201', expect.objectContaining({ method: 'PUT' }));
  await deleteCompareTemplate('t 1');
  expect(fetchMock).toHaveBeenLastCalledWith('/compare-templates/t%201', { method: 'DELETE' });
});

it('exports the file as text', async () => {
  fetchMock.mockResolvedValue(ok(null, 'items: []\n'));
  expect(await exportCompareTemplatesYaml()).toBe('items: []\n');
  expect(fetchMock).toHaveBeenCalledWith('/provisioning/compare-templates/export', { cache: 'no-store' });
});

it("addresses a profile's templates under the profile, like its SLOs, and links to the profile's tab", async () => {
  const PROFILE = 'dddddddd-0000-4000-8000-00000000000d';
  fetchMock.mockResolvedValue(ok({ templates: [] }));
  await fetchCompareTemplates({ kind: 'profile', profileId: PROFILE });
  expect(fetchMock).toHaveBeenCalledWith(`/profiles/${PROFILE}/compare-templates`, { cache: 'no-store' });

  fetchMock.mockResolvedValue(ok({ id: 't' }));
  await createCompareTemplate({ kind: 'profile', profileId: PROFILE }, { panelId: 1, metricClassification: 'x' });
  expect(fetchMock).toHaveBeenCalledWith(`/profiles/${PROFILE}/compare-templates`, expect.objectContaining({ method: 'POST' }));

  expect(templatesPageHref({ kind: 'profile', profileId: PROFILE })).toBe(`/settings/profiles/${PROFILE}?tab=adapt-templates`);
});
