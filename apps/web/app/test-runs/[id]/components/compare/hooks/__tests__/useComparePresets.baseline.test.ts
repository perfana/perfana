/**
 * The baseline a compare preset was saved against must be restored when it is applied.
 *
 * Every preset stores `baseline_test_run_id` and prints it in its own description, but the
 * restore used to be gated on `preset_type === SPECIFIC`. A generic preset therefore applied
 * its series, said so in a toast, and left the comparison selector empty — so the card drew
 * nothing until the user re-picked the very run the preset names, with nothing logged.
 *
 * These cases pin the rule the fix introduced: both types restore, and they differ only in
 * who wins when the user has already chosen a run.
 */
import { renderHook } from '@testing-library/react';
import { PresetType } from '@/lib/compare-presets';
import { useComparePresets } from '../useComparePresets';
import type { ComparePreset } from '../../ComparePresetsTable';
import type { RelatedTestRun } from '../../types';

jest.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

jest.mock('@/lib/compare-presets', () => ({
  ...jest.requireActual('@/lib/compare-presets'),
  ComparePresetsAPI: { getAll: jest.fn().mockResolvedValue([]) },
}));

const BASELINE = { test_run_id: 'run-00003' } as RelatedTestRun;
const OTHER = { test_run_id: 'run-00002' } as RelatedTestRun;

const preset = (over: Partial<ComparePreset> = {}): ComparePreset =>
  ({
    id: 'preset-1',
    name: 'Transaction RT',
    preset_type: PresetType.GENERIC,
    baseline_test_run_id: 'run-00003',
    show_percentiles: false,
    series_config: [],
    ...over,
  }) as ComparePreset;

function setup(selectedTestRun: RelatedTestRun | null) {
  const setSelectedTestRun = jest.fn();
  const { result } = renderHook(() =>
    useComparePresets({
      testRun: null,
      testRunId: 'run-00004',
      showToast: jest.fn(),
      selectedSource: 'grafana' as never,
      addedSeries: [],
      dashboards: [],
      relatedTestRuns: [BASELINE, OTHER],
      selectedTestRun,
      setSelectedSource: jest.fn(),
      setSelectedDashboard: jest.fn(),
      setSelectedMetric: jest.fn(),
      setAddedSeries: jest.fn(),
      setSelectedTestRun,
      setSeriesSearchText: jest.fn(),
      setShowPercentiles: jest.fn(),
      setDisplayConfig: jest.fn(),
    }),
  );
  // The hook's preset-list effect logs an unwrapped act() warning here. Deliberately not
  // flushed with `await act(...)`: the effect re-triggers on its own state, so awaiting it
  // never settles and every case times out at 10s. The warning is noise; the hang is not.
  return { result, setSelectedTestRun };
}

describe('useComparePresets — restoring the preset baseline', () => {
  it('restores a GENERIC preset baseline into an empty selector', async () => {
    const { result, setSelectedTestRun } = setup(null);
    await result.current.applyPreset(preset());
    expect(setSelectedTestRun).toHaveBeenCalledWith(BASELINE);
  });

  it('leaves a run the user already chose alone for a GENERIC preset', async () => {
    const { result, setSelectedTestRun } = setup(OTHER);
    await result.current.applyPreset(preset());
    expect(setSelectedTestRun).not.toHaveBeenCalled();
  });

  it('overrides the current selection for a SPECIFIC preset, which is locked to its baseline', async () => {
    const { result, setSelectedTestRun } = setup(OTHER);
    await result.current.applyPreset(preset({ preset_type: PresetType.SPECIFIC }));
    expect(setSelectedTestRun).toHaveBeenCalledWith(BASELINE);
  });

  it('leaves the selector alone when the stored baseline is no longer comparable', async () => {
    const { result, setSelectedTestRun } = setup(null);
    await result.current.applyPreset(preset({ baseline_test_run_id: 'run-deleted' }));
    expect(setSelectedTestRun).not.toHaveBeenCalled();
  });

  it('does nothing when the preset carries no baseline at all', async () => {
    const { result, setSelectedTestRun } = setup(null);
    await result.current.applyPreset(preset({ baseline_test_run_id: undefined }));
    expect(setSelectedTestRun).not.toHaveBeenCalled();
  });
});
