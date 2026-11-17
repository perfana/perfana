import { buildSourceTree, describeMapping, SPLUNK_MASK } from '@/lib/splunk';
import { toSplunkInput } from '@/app/integrations/components/SplunkIntegration';

describe('buildSourceTree', () => {
  it('groups index -> sourcetype -> host and orders every level by event count', () => {
    const tree = buildSourceTree([
      { index: 'web', sourcetype: 'nginx', host: 'a', count: 5 },
      { index: 'java', sourcetype: 'log4j', host: 'svc-1', count: 100 },
      { index: 'web', sourcetype: 'nginx', host: 'b', count: 50 },
      { index: 'web', sourcetype: 'syslog', host: 'a', count: 1 },
    ]);
    expect(tree.map((i) => [i.index, i.count])).toEqual([['java', 100], ['web', 56]]);
    expect(tree[1]!.sourcetypes.map((s) => s.sourcetype)).toEqual(['nginx', 'syslog']);
    expect(tree[1]!.sourcetypes[0]!.hosts.map((h) => h.host)).toEqual(['b', 'a']);
  });
});

describe('describeMapping', () => {
  it('names only the parts the mapping sets', () => {
    expect(describeMapping({ indexName: 'web', sourcetype: null, hostPattern: 'app-*' })).toBe('index=web host=app-*');
  });
});

describe('toSplunkInput', () => {
  const form = {
    label: ' prod ', host: ' https://s:8089 ', clientUrl: '', apiToken: SPLUNK_MASK, username: '', password: '',
    splunkApp: '', useProxy: false, maxConcurrentSearches: 2,
  };

  it('sends a masked credential back as the mask, which the API reads as unchanged', () => {
    expect(toSplunkInput(form)).toMatchObject({ label: 'prod', host: 'https://s:8089', apiToken: SPLUNK_MASK, password: null, clientUrl: null, splunkApp: 'search' });
  });

  it('names the organization only when one is given', () => {
    expect(toSplunkInput(form, 'org-1').organizationId).toBe('org-1');
    expect('organizationId' in toSplunkInput(form, null)).toBe(false);
  });
});
