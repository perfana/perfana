/**
 * REGRESSION: the save dialog sent `test_run_id: undefined` for its default "Global"
 * scope. The API resolves the preset's owning system from that id, so with none it fell
 * through to `findOne({ where: { testRunId: undefined } })` — "any test run" — and the
 * preset was stamped with an arbitrary system's organization, then listed on every
 * system. The API now refuses a create with no run id, so a dialog that omits it is a
 * 400 rather than a silent cross-tenant leak; either way the id must always be sent.
 *
 * The second half: the radio's selected value used to be derived from `test_run_id`
 * ("set" meant test-run-specific). Now that the id is always set, that reading would
 * pin the dialog on "Test Run Specific" forever — scope has to be read from
 * `is_global`.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SaveGraphPresetModal from '../SaveGraphPresetModal';
import type { SeriesConfig } from '@/lib/graph-presets';

const SERIES = [
  { dashboardId: 'ad-1', panelId: 1, metricName: 'checkout', dashboardLabel: 'Perf' },
] as unknown as SeriesConfig[];

const RUN = 'run-abc';

function renderModal(onSave: jest.Mock, opts: { testRunId?: string } = { testRunId: RUN }) {
  return render(
    <SaveGraphPresetModal
      open
      onClose={jest.fn()}
      onSave={onSave}
      currentTestRunId={opts.testRunId}
      currentSeriesConfig={SERIES}
      defaultName="My preset"
    />,
  );
}

const save = () => fireEvent.click(screen.getByRole('button', { name: /save preset/i }));
const radio = (name: RegExp) => screen.getByRole('radio', { name }) as HTMLInputElement;

describe('SaveGraphPresetModal scope', () => {
  it('defaults to the system-wide scope and still sends the test run id', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    renderModal(onSave);

    expect(radio(/All runs of this system/)).toBeChecked();
    save();

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ is_global: true, test_run_id: RUN });
  });

  it('sends the run id and is_global false for a test-run-specific preset', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    renderModal(onSave);

    fireEvent.click(radio(/Test Run Specific/));
    expect(radio(/Test Run Specific/)).toBeChecked();
    save();

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ is_global: false, test_run_id: RUN });
  });

  // With `test_run_id` always set, a radio keyed on it could never come back.
  it('can switch back to the system-wide scope', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    renderModal(onSave);

    fireEvent.click(radio(/Test Run Specific/));
    fireEvent.click(radio(/All runs of this system/));
    expect(radio(/All runs of this system/)).toBeChecked();
    save();

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ is_global: true, test_run_id: RUN });
  });

  // GAP, pre-existing and left as-is: `disabled={!currentTestRunId}` sits on the
  // FormControlLabel and does not reach the radio input, so the option is still
  // clickable with no run to scope to. It now lands as a 400 from the API ("testRunId
  // is required") rather than a silently mis-scoped preset, and the dialog surfaces
  // nothing. Pinned so the day it is fixed, this test is what says so.
  it('still sends no run id when there is no run to scope to', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    renderModal(onSave, {});

    expect(radio(/All runs of this system/)).toBeChecked();
    fireEvent.click(radio(/Test Run Specific/));
    save();

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ is_global: false, test_run_id: undefined });
  });
});
