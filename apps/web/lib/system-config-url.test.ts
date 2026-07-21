import { buildSystemConfigUrl } from './system-config-url';

describe('buildSystemConfigUrl', () => {
  it('builds the full URL with all params encoded', () => {
    const url = buildSystemConfigUrl({
      systemId: 'sys-1',
      tab: 'slo',
      environment: 'acc test',
      workload: 'load/1',
      fromTestRun: 'Run 1/2',
    });
    const parsed = new URLSearchParams(url.split('?')[1]);
    expect(url.startsWith('/systems/sys-1/config?')).toBe(true);
    expect(parsed.get('tab')).toBe('slo');
    expect(parsed.get('environment')).toBe('acc test');
    expect(parsed.get('workload')).toBe('load/1');
    expect(parsed.get('fromTestRun')).toBe('Run 1/2');
  });

  it('omits falsy optional params', () => {
    const url = buildSystemConfigUrl({ systemId: 'sys-1', tab: '2', environment: '', workload: null });
    expect(url).toBe('/systems/sys-1/config?tab=2');
  });
});
