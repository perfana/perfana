import { buildComparisonUrl, buildDeepLinkUrl, buildMDAUrl, buildServiceFilterParam, createPlatformUrl, deepLinkBaseUrl } from '../dynatrace-formatters';
import { DynatraceConfig, DynatraceEntity, RelatedTestRun } from '../../types';
import { TestRun } from '@/types/test-runs';

const managedConfig = {
  id: 'cfg-1',
  host: 'https://dt-managed.example.com/e/env-1',
  apiToken: 't',
  dynatraceType: 'managed',
  label: 'managed',
  perfanaTestRunIdAttribute: '4633f5c1-3735-4f19-bd45-d44e5b89e54e',
  perfanaRequestNameAttribute: '035fcdc7-16c9-4def-8f9f-3252f7f4f4a7',
  createdAt: '',
  updatedAt: '',
} as DynatraceConfig;

const entity = { entityId: 'SERVICE-123', displayName: 'svc', type: 'SERVICE' } as DynatraceEntity;

const testRun = {
  test_run_id: 'run-1',
  start_time: '2026-07-16T10:00:00.000Z',
  end_time: '2026-07-16T11:00:00.000Z',
} as TestRun;

// Managed /ui/services/* routes use the 'ui' filter format (see useDynatraceHandlers)
const serviceFilterParam = buildServiceFilterParam(managedConfig, testRun.test_run_id, null, '', '', 'ui');
const deepLinkFilterArg = `&servicefilter=${serviceFilterParam}`;

describe('managed Dynatrace deep links carry the request-attribute servicefilter', () => {
  it('top-web-requests includes servicefilter', () => {
    const url = buildDeepLinkUrl('top-web-requests', entity, managedConfig, testRun, deepLinkFilterArg);
    expect(url).toContain(`servicefilter=${serviceFilterParam}`);
    expect(url).toContain('/ui/services/SERVICE-123/mda?mdaId=topweb');
  });

  it('pure-paths includes servicefilter', () => {
    const url = buildDeepLinkUrl('pure-paths', entity, managedConfig, testRun, deepLinkFilterArg);
    expect(url).toContain(`servicefilter=${serviceFilterParam}`);
    expect(url).toContain('/ui/services/SERVICE-123/purepaths');
  });

  it('MDA is service-scoped and keeps servicefilter without the attribute UUID in the dimension', () => {
    const url = buildMDAUrl('response-times', entity, managedConfig, testRun, serviceFilterParam);
    expect(url).toContain('/ui/services/SERVICE-123/mda?');
    expect(url).toContain(`servicefilter=${serviceFilterParam}`);
    // {RequestAttribute:<uuid>} is invalid — MDA dimensions take the attribute name, not its id
    expect(url).toContain('dimension=%7BRequest:Name%7D&');
    expect(url).not.toContain('RequestAttribute');
  });
});

describe('buildServiceFilterParam ui format (managed /ui/services/* routes)', () => {
  it('emits bare blocks: request-name first, URI-encoded values, no trailing empty fields', () => {
    const param = buildServiceFilterParam(
      managedConfig,
      'EA-acc-loadtest-00015',
      'Documenten_zoeken|EA_07_Open_document|EA_07_Open_document_01_POST_/navigator/jaxrs/p8/openItem',
      '',
      '',
      'ui'
    );
    expect(param).toBe(
      '0%1E15%11035fcdc7-16c9-4def-8f9f-3252f7f4f4a7' +
        '%14Documenten_zoeken%7CEA_07_Open_document%7CEA_07_Open_document_01_POST_%2Fnavigator%2Fjaxrs%2Fp8%2FopenItem' +
        '%1015%114633f5c1-3735-4f19-bd45-d44e5b89e54e%14EA-acc-loadtest-00015'
    );
  });

  it('omits the request-name block without a selected metric and appends duration blocks', () => {
    const param = buildServiceFilterParam(managedConfig, 'run-1', null, '1', '2', 'ui');
    expect(param).toBe(
      '0%1E15%114633f5c1-3735-4f19-bd45-d44e5b89e54e%14run-1%100%111000%142000'
    );
  });

  it("omits the request-name block for the 'all' metric and for configs without the attribute", () => {
    const testRunOnly = '0%1E15%114633f5c1-3735-4f19-bd45-d44e5b89e54e%14run-1';
    expect(buildServiceFilterParam(managedConfig, 'run-1', 'all', '', '', 'ui')).toBe(testRunOnly);
    const noRequestAttr = { ...managedConfig, perfanaRequestNameAttribute: undefined } as DynatraceConfig;
    expect(buildServiceFilterParam(noRequestAttr, 'run-1', 'a|b|c', '', '', 'ui')).toBe(testRunOnly);
  });

  it('min-only and max-only durations produce open-ended range blocks', () => {
    expect(buildServiceFilterParam(managedConfig, 'run-1', null, '1', '', 'ui')).toBe(
      '0%1E15%114633f5c1-3735-4f19-bd45-d44e5b89e54e%14run-1%100%111000%144611686018427387'
    );
    expect(buildServiceFilterParam(managedConfig, 'run-1', null, '', '2', 'ui')).toBe(
      '0%1E15%114633f5c1-3735-4f19-bd45-d44e5b89e54e%14run-1%100%110%142000'
    );
  });

  it('classic format is unchanged (SaaS + classic-hash routes)', () => {
    const param = buildServiceFilterParam(managedConfig, 'run/1', null, '', '');
    expect(param).toBe(
      '0%1E15%114633f5c1-3735-4f19-bd45-d44e5b89e54e%14run%5C01%140%14%14%14%14'
    );
  });
});

describe('client URL overrides the server URL in deep links', () => {
  const saasConfig = {
    ...managedConfig,
    dynatraceType: 'saas',
    host: 'https://abc12345.live.dynatrace.com',
  } as DynatraceConfig;

  it('falls back to host when no clientUrl is set', () => {
    expect(deepLinkBaseUrl(managedConfig)).toBe('https://dt-managed.example.com/e/env-1');
  });

  it('uses clientUrl and strips its trailing slash', () => {
    expect(deepLinkBaseUrl({ ...managedConfig, clientUrl: 'https://dt.example.com/' }))
      .toBe('https://dt.example.com');
  });

  it('managed classic links point at the client URL', () => {
    const url = buildDeepLinkUrl(
      'method-hotspots',
      entity,
      { ...managedConfig, clientUrl: 'https://dt.example.com' } as DynatraceConfig,
      testRun,
      '',
    );
    expect(url).toContain('https://dt.example.com/#methodhotspots');
    expect(url).not.toContain('dt-managed.example.com');
  });

  it('SaaS platform links derive the apps host from the client URL', () => {
    const url = buildDeepLinkUrl(
      'pure-paths',
      entity,
      { ...saasConfig, clientUrl: 'https://xyz99999.live.dynatrace.com' } as DynatraceConfig,
      testRun,
      '',
    );
    expect(url).toContain('https://xyz99999.apps.dynatrace.com/ui/apps/');
  });

  it('leaves a client URL that already names the apps host alone', () => {
    expect(createPlatformUrl('https://xyz99999.apps.dynatrace.com'))
      .toBe('https://xyz99999.apps.dynatrace.com');
  });

  // Regression: createPlatformUrl used to strip 'https://' and graft
  // '.apps.dynatrace.com' onto whatever was left, so the proxy / split-DNS
  // address this whole feature exists for became
  // 'https://dt-proxy.corp.example.com.apps.dynatrace.com' — a host that does
  // not resolve. Every SaaS deep link was broken for exactly the intended case.
  it.each([
    'https://dt-proxy.corp.example.com',
    'http://dynatrace.internal:9999',
    'https://dynatrace.example.com',
    'https://internal.apps.dynatrace.com.corp.example.com',
  ])('leaves the non-tenant client URL %s untouched', (proxy) => {
    expect(createPlatformUrl(proxy)).toBe(proxy);
  });

  it('SaaS deep links through a proxy client URL stay on the proxy host', () => {
    const url = buildDeepLinkUrl(
      'pure-paths',
      entity,
      { ...saasConfig, clientUrl: 'https://dt-proxy.corp.example.com' } as DynatraceConfig,
      testRun,
      '',
    );
    expect(url).toContain('https://dt-proxy.corp.example.com/ui/apps/');
    expect(url).not.toContain('.com.apps.dynatrace.com');
  });
});

describe('client URL edge cases and the remaining link builders', () => {
  const saasConfig = {
    ...managedConfig,
    dynatraceType: 'saas',
    host: 'https://abc12345.live.dynatrace.com',
  } as DynatraceConfig;

  it('treats an empty clientUrl as unset and falls back to host', () => {
    // The edit dialog clears the field by PATCHing '', and the API stores ''
    // verbatim — so the read side has to treat '' as "not configured".
    expect(deepLinkBaseUrl({ ...managedConfig, clientUrl: '' }))
      .toBe('https://dt-managed.example.com/e/env-1');
  });

  it('returns an empty string when neither clientUrl nor host is set', () => {
    expect(deepLinkBaseUrl({ host: '', clientUrl: '' })).toBe('');
    expect(deepLinkBaseUrl({} as DynatraceConfig)).toBe('');
  });

  it('managed MDA links point at the client URL', () => {
    const url = buildMDAUrl(
      'response-times',
      entity,
      { ...managedConfig, clientUrl: 'https://dt.example.com/' } as DynatraceConfig,
      testRun,
      serviceFilterParam,
    );
    expect(url).toContain('https://dt.example.com/ui/services/SERVICE-123/mda?');
    expect(url).not.toContain('dt-managed.example.com');
  });

  it('SaaS MDA links derive the apps host from the client URL', () => {
    const url = buildMDAUrl(
      'response-times',
      entity,
      { ...saasConfig, clientUrl: 'https://xyz99999.live.dynatrace.com' } as DynatraceConfig,
      testRun,
      serviceFilterParam,
    );
    expect(url).toContain('https://xyz99999.apps.dynatrace.com/ui/apps/dynatrace.classic.mda/');
    expect(url).not.toContain('abc12345');
  });

  it('the comparison link uses the client URL, and bails out when there is no base URL', () => {
    const comparisonRun = { test_run_id: 'run-0', start_time: '2026-07-15T10:00:00.000Z', created_at: '2026-07-15T09:00:00.000Z' } as RelatedTestRun;

    const url = buildComparisonUrl(
      'SERVICE-123',
      { ...managedConfig, clientUrl: 'https://dt.example.com' } as DynatraceConfig,
      testRun,
      comparisonRun,
      null,
      '',
      '',
    );
    expect(url).toContain('https://dt.example.com/#serviceComparison');
    expect(url).not.toContain('dt-managed.example.com');

    // Guard preserved from the old `config.host?.replace(...)` shape
    expect(
      buildComparisonUrl(
        'SERVICE-123',
        { ...managedConfig, host: '', clientUrl: '' } as DynatraceConfig,
        testRun,
        comparisonRun,
        null,
        '',
        '',
      ),
    ).toBe('');
  });
});
