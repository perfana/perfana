import { Test } from '@nestjs/testing';
import { ReportSectionConfig, TestRun } from '@perfana/shared';
import { DynatraceHostsRenderer, NO_LABEL_GROUP, groupByLabel, pickColumns } from './dynatrace-hosts-renderer';
import { DynatraceService } from '../../dynatrace/dynatrace.service';
import { HostReportRow } from '../../dynatrace/dto/host.dto';

const section = (config: Record<string, unknown> = {}): ReportSectionConfig => ({ type: 'dynatrace_hosts', order: 1, config });

const testRun = {
  testRunId: 'run-1',
  systemUnderTestId: 'sut',
  testEnvironment: 'acc',
  workload: 'load',
  startTime: new Date('2026-09-21T10:00:00Z'),
  endTime: new Date('2026-09-21T11:00:00Z'),
} as TestRun;

const rows: HostReportRow[] = [
  { hostId: 'HOST-1', displayName: 'web01', labels: ['web'], cpuAvg: 12.34, cpuCores: 4, memAvg: 55.5, memoryTotal: 17179869184 },
  { hostId: 'HOST-2', displayName: 'db01 <x>', labels: [], cpuAvg: 80, cpuCores: null, memAvg: null, memoryTotal: null, problemCount: 2, worstSeverity: 'ERROR' },
];

describe('pickColumns', () => {
  it('defaults to cpu + memory and drops unknown values', () => {
    expect(pickColumns(undefined)).toEqual(['cpu', 'memory']);
    expect(pickColumns(['bogus'])).toEqual(['cpu', 'memory']);
    expect(pickColumns(['network', 'cpu', 'x'])).toEqual(['cpu', 'network']);
  });
});

describe('DynatraceHostsRenderer', () => {
  let renderer: DynatraceHostsRenderer;
  let dynatrace: { fetchHostsReport: jest.Mock };

  beforeEach(async () => {
    dynatrace = { fetchHostsReport: jest.fn().mockResolvedValue(rows) };
    const module = await Test.createTestingModule({
      providers: [DynatraceHostsRenderer, { provide: DynatraceService, useValue: dynatrace }],
    }).compile();
    renderer = module.get(DynatraceHostsRenderer);
  });

  it('passes the hosts and columns from the config and renders the default columns', async () => {
    const html = await renderer.renderDynatraceHostsSection(section({ hostIds: ['HOST-1', 'HOST-2'] }), testRun);

    expect(dynatrace.fetchHostsReport).toHaveBeenCalledWith('sut', 'acc', 'load', testRun.startTime, testRun.endTime, {
      hostIds: ['HOST-1', 'HOST-2'],
      columns: ['cpu', 'memory'],
    });
    expect(html).toContain('CPU cores');
    expect(html).toContain('Memory total');
    expect(html).not.toContain('Disk util');
    expect(html).toContain('12.3%');
    expect(html).toContain('16 GB');
    expect(html).toContain('db01 &lt;x&gt;');
    // Problem host sorts first even though the column is off.
    expect(html.indexOf('db01')).toBeLessThan(html.indexOf('web01'));
  });

  it('renders optional columns and the problem pill', async () => {
    const html = await renderer.renderDynatraceHostsSection(section({ columns: ['disk', 'network', 'problems'] }), testRun);
    expect(html).toContain('Disk util avg');
    expect(html).toContain('Network traffic avg');
    expect(html).not.toContain('CPU cores');
    expect(html).toContain('>2<');
    expect(html).toContain('healthy');
  });

  it('shows an empty state when no hosts are mapped and a warning when Dynatrace fails', async () => {
    dynatrace.fetchHostsReport.mockResolvedValueOnce([]);
    expect(await renderer.renderDynatraceHostsSection(section(), testRun)).toContain('No Dynatrace hosts');
    dynatrace.fetchHostsReport.mockRejectedValueOnce(new Error('boom'));
    expect(await renderer.renderDynatraceHostsSection(section(), testRun)).toContain('Section incomplete');
    expect(await renderer.renderDynatraceHostsSection(section(), null)).toContain('No test run data');
  });
});

describe('groupByLabel', () => {
  it('lists a host under each label, sorted, with unlabelled hosts last', () => {
    const a = { hostId: 'a', displayName: 'a', labels: ['web', 'backend'] };
    const b = { hostId: 'b', displayName: 'b', labels: [] };
    const c = { hostId: 'c', displayName: 'c', labels: ['web'] };
    expect(groupByLabel([a, b, c])).toEqual([
      { label: 'backend', hosts: [a] },
      { label: 'web', hosts: [a, c] },
      { label: NO_LABEL_GROUP, hosts: [b] },
    ]);
  });

  it('renders one table per label when the section asks for it', async () => {
    const dynatrace = { fetchHostsReport: jest.fn().mockResolvedValue(rows) };
    const module = await Test.createTestingModule({
      providers: [DynatraceHostsRenderer, { provide: DynatraceService, useValue: dynatrace }],
    }).compile();
    const html = await module.get(DynatraceHostsRenderer).renderDynatraceHostsSection(section({ groupByLabel: true }), testRun);
    expect(html.match(/<table/g)).toHaveLength(2);
    expect(html).toContain('1 host<');
    expect(html).toContain('2 hosts');
    expect(html).toContain(NO_LABEL_GROUP);
  });
});
