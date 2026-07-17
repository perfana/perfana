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

describe('useDynatraceHandlers servicefilter format selection', () => {
  const attrConfigs = (dynatraceType: 'managed' | 'saas'): DynatraceConfig[] => [{
    id: 'cfg-1', host: 'https://dt.example.com/e/env-1', apiToken: 't', dynatraceType,
    label: 'dt', perfanaTestRunIdAttribute: 'attr-uuid', createdAt: '', updatedAt: '',
  } as DynatraceConfig];
  const entity: DynatraceEntity = { entityId: 'SERVICE-1', displayName: 'svc', type: 'SERVICE', dynatraceConfigId: 'cfg-1' };
  const CLASSIC_BLOCK = '15%11attr-uuid%14run-1%140%14%14%14%14';
  const UI_BLOCK = '0%1E15%11attr-uuid%14run-1&';

  let openSpy: jest.SpyInstance;
  beforeEach(() => {
    openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
  });
  afterEach(() => openSpy.mockRestore());

  const openedUrl = () => String(openSpy.mock.calls[0][0]);

  function renderWith(dynatraceType: 'managed' | 'saas') {
    return renderHook(() =>
      useDynatraceHandlers({
        testRun, configs: attrConfigs(dynatraceType), selectedMetric: null, minDuration: '', maxDuration: '',
      })
    ).result.current;
  }

  it('managed top-web-requests uses the ui format (no trailing empty fields)', () => {
    renderWith('managed').handleDeepLinkClick(entity, 'top-web-requests');
    expect(openedUrl()).toContain(`servicefilter=${UI_BLOCK}`);
    expect(openedUrl()).not.toContain(CLASSIC_BLOCK);
  });

  it('managed pure-paths uses the ui format', () => {
    renderWith('managed').handleDeepLinkClick(entity, 'pure-paths');
    expect(openedUrl()).toContain(`servicefilter=${UI_BLOCK}`);
  });

  it('managed MDA uses the ui format', () => {
    renderWith('managed').handleMultiDimensionalAnalysis(entity, 'response-times');
    expect(openedUrl()).toContain('servicefilter=0%1E15%11attr-uuid%14run-1');
    expect(openedUrl()).not.toContain(CLASSIC_BLOCK);
  });

  it('managed classic-hash links keep the classic format', () => {
    renderWith('managed').handleDeepLinkClick(entity, 'response-time-hotspots');
    expect(openedUrl()).toContain(CLASSIC_BLOCK);
  });

  it('saas top-web-requests keeps the classic format', () => {
    renderWith('saas').handleDeepLinkClick(entity, 'top-web-requests');
    expect(openedUrl()).toContain(CLASSIC_BLOCK);
  });

  it('saas MDA keeps the classic format', () => {
    renderWith('saas').handleMultiDimensionalAnalysis(entity, 'response-times');
    expect(openedUrl()).toContain(CLASSIC_BLOCK);
    expect(openedUrl()).not.toContain(UI_BLOCK);
  });
});
