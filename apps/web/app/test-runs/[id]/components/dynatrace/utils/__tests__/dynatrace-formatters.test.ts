import { buildDeepLinkUrl, buildMDAUrl, buildServiceFilterParam } from '../dynatrace-formatters';
import { DynatraceConfig, DynatraceEntity } from '../../types';
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

const serviceFilterParam = buildServiceFilterParam(managedConfig, testRun.test_run_id, null, '', '');
// buildDeepLinkUrl callers prepend the separator (see useDynatraceHandlers)
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
