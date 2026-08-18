/**
 * Unit tests for BaselineRunSelect.
 *
 * The picker gained a synthetic first option — "Previous run" — because pinning a specific run
 * is the wrong default for a template: a template is generated from for months, so the run
 * chosen today is stale tomorrow and every nightly report keeps comparing against it.
 *
 * The synthetic option has no run behind it, so it has no timestamp, no environment and no
 * workload; every code path that formats a candidate has to survive that.
 */

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  BaselineRunSelect,
  PREVIOUS_RUN_BASELINE,
  type BaselineCandidate,
} from '@/components/reports/report-generation/BaselineRunSelect';

const candidate = (overrides: Partial<BaselineCandidate> = {}): BaselineCandidate => ({
  test_run_id: 'EA-acc-loadtest-00019',
  test_environment: 'acc',
  workload: 'loadTest',
  start_time: '2026-08-17T10:00:00.000Z',
  created_at: '2026-08-17T10:00:00.000Z',
  ...overrides,
});

const openDropdown = () => {
  fireEvent.click(screen.getByRole('button', { name: /open/i }));
  return screen.getByRole('listbox');
};

describe('BaselineRunSelect previous-run option', () => {
  it('offers "Previous run" ahead of the real runs', () => {
    render(<BaselineRunSelect candidates={[candidate()]} onChange={jest.fn()} />);

    const options = within(openDropdown()).getAllByRole('option');
    expect(options[0]).toHaveTextContent('Previous run');
    expect(options[0]).toHaveTextContent(/never goes stale/i);
    expect(options[1]).toHaveTextContent('EA-acc-loadtest-00019');
  });

  it('is offered even when the system has no other runs to pin', () => {
    // An empty candidate list used to mean an empty dropdown; the synthetic option is not
    // sourced from the list, so it stands on its own.
    render(<BaselineRunSelect candidates={[]} onChange={jest.fn()} />);

    const options = within(openDropdown()).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Previous run');
  });

  it('hands the caller the sentinel the API resolves per report', () => {
    const onChange = jest.fn();
    render(<BaselineRunSelect candidates={[candidate()]} onChange={onChange} />);

    fireEvent.click(within(openDropdown()).getAllByRole('option')[0]!);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ test_run_id: PREVIOUS_RUN_BASELINE }),
    );
  });

  it('labels the selected sentinel by name, not by a date it does not have', () => {
    // The synthetic option has no start_time; formatting it as a run would print "Invalid Date".
    render(
      <BaselineRunSelect
        candidates={[candidate()]}
        value={PREVIOUS_RUN_BASELINE}
        onChange={jest.fn()}
      />,
    );

    expect(screen.getByRole('combobox')).toHaveValue('Previous run');
    expect(screen.queryByDisplayValue(/Invalid Date/)).not.toBeInTheDocument();
  });

  it('explains what "previous" resolves to instead of naming a run', () => {
    render(
      <BaselineRunSelect
        candidates={[candidate()]}
        value={PREVIOUS_RUN_BASELINE}
        onChange={jest.fn()}
      />,
    );

    expect(screen.getByText('Each report compares against the run before it')).toBeInTheDocument();
    expect(screen.queryByText(/Comparing with/)).not.toBeInTheDocument();
  });
});

describe('BaselineRunSelect pinned runs', () => {
  it('still names a pinned run in the helper text', () => {
    render(
      <BaselineRunSelect
        candidates={[candidate()]}
        value="EA-acc-loadtest-00019"
        onChange={jest.fn()}
      />,
    );

    expect(screen.getByText('Comparing with: EA-acc-loadtest-00019')).toBeInTheDocument();
  });

  it('falls back to the count when nothing is selected', () => {
    render(<BaselineRunSelect candidates={[candidate(), candidate({ test_run_id: 'x' })]} onChange={jest.fn()} />);

    expect(screen.getByText('Select from 2 available test runs')).toBeInTheDocument();
  });

  it('shows no selection for a value that is neither the sentinel nor a known run', () => {
    // A template pinned to a run that has since been deleted.
    render(
      <BaselineRunSelect candidates={[candidate()]} value="EA-acc-loadtest-00001" onChange={jest.fn()} />,
    );

    expect(screen.getByRole('combobox')).toHaveValue('');
  });

  it('lets an explicit helperText win over both branches', () => {
    render(
      <BaselineRunSelect
        candidates={[candidate()]}
        value={PREVIOUS_RUN_BASELINE}
        onChange={jest.fn()}
        helperText="Set once for every section"
      />,
    );

    expect(screen.getByText('Set once for every section')).toBeInTheDocument();
    expect(
      screen.queryByText('Each report compares against the run before it'),
    ).not.toBeInTheDocument();
  });
});
