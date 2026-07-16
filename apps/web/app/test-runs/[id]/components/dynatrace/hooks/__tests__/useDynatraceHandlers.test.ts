import { renderHook } from '@testing-library/react';
import { useDynatraceHandlers } from '../useDynatraceHandlers';
import { DynatraceConfig, DynatraceEntity, DynatraceEntityMapping } from '../../types';
import { TestRun } from '@/types/test-runs';

// Deep-link URLs embed config.host verbatim (dynatrace-formatters.buildDeepLinkUrl),
// so asserting on the opened URL tells us which instance was targeted.

const configs: DynatraceConfig[] = [
  { id: 'cfg-1', host: 'https://first.dynatrace.example', apiToken: 't1', dynatraceType: 'managed', label: 'First', createdAt: '', updatedAt: '' },
  { id: 'cfg-2', host: 'https://second.dynatrace.example', apiToken: 't2', dynatraceType: 'managed', label: 'Second', createdAt: '', updatedAt: '' },
];

const testRun = {
  test_run_id: 'run-1',
  start_time: '2026-07-16T00:00:00.000Z',
  end_time: '2026-07-16T00:10:00.000Z',
} as unknown as TestRun;

function renderHandlers() {
  return renderHook(() =>
    useDynatraceHandlers({ testRun, configs, selectedMetric: null, minDuration: '', maxDuration: '' })
  ).result.current;
}

describe('useDynatraceHandlers instance selection', () => {
  let openSpy: jest.SpyInstance;
  beforeEach(() => {
    openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
  });
  afterEach(() => openSpy.mockRestore());

  it('deep link targets the instance the entity was mapped from, not configs[0]', () => {
    const entity: DynatraceEntity = {
      entityId: 'SERVICE-2', displayName: 'svc', type: 'SERVICE', dynatraceConfigId: 'cfg-2',
    };
    renderHandlers().handleDeepLinkClick(entity, 'response-time-hotspots');
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(String(openSpy.mock.calls[0][0])).toContain('second.dynatrace.example');
  });

  it('falls back to configs[0] when the entity has no / an unknown config id', () => {
    const entity: DynatraceEntity = {
      entityId: 'SERVICE-x', displayName: 'svc', type: 'SERVICE', dynatraceConfigId: 'cfg-missing',
    };
    renderHandlers().handleDeepLinkClick(entity, 'response-time-hotspots');
    expect(String(openSpy.mock.calls[0][0])).toContain('first.dynatrace.example');
  });

  it('comparison targets the mapping instance', () => {
    const mapping = {
      id: 'm1', entityId: 'SERVICE-2', entityDisplayName: 'svc', entityType: 'SERVICE',
      dynatraceConfigId: 'cfg-2', systemUnderTestId: 'sut', level: 'service', createdAt: '', updatedAt: '',
    } as DynatraceEntityMapping;
    renderHandlers().handleComparisonClick(mapping, {
      test_run_id: 'run-2', created_at: '', completed: true,
      start_time: '2026-07-15T00:00:00.000Z',
    });
    expect(String(openSpy.mock.calls[0]?.[0] ?? '')).toContain('second.dynatrace.example');
  });
});
