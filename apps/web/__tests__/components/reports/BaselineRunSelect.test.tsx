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
  PREVIOUS_SUCCESSFUL_RUN_BASELINE,
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
    expect(options[1]).toHaveTextContent('Previous SLO-passing run');
    expect(options[1]).toHaveTextContent(/passed its SLOs/i);
    expect(options[2]).toHaveTextContent('EA-acc-loadtest-00019');
  });

  it('is offered even when the system has no other runs to pin', () => {
    // An empty candidate list used to mean an empty dropdown; the synthetic option is not
    // sourced from the list, so it stands on its own.
    render(<BaselineRunSelect candidates={[]} onChange={jest.fn()} />);

    const options = within(openDropdown()).getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('Previous run');
    expect(options[1]).toHaveTextContent('Previous SLO-passing run');
  });

  it('hands the caller the SLO-passed sentinel from the second option', () => {
    const onChange = jest.fn();
    render(<BaselineRunSelect candidates={[candidate()]} onChange={onChange} />);

    fireEvent.click(within(openDropdown()).getAllByRole('option')[1]!);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ test_run_id: PREVIOUS_SUCCESSFUL_RUN_BASELINE }),
    );
  });

  it('explains what "previous successful" resolves to instead of naming a run', () => {
    render(
      <BaselineRunSelect
        candidates={[candidate()]}
        value={PREVIOUS_SUCCESSFUL_RUN_BASELINE}
        onChange={jest.fn()}
      />,
    );

    expect(screen.getByRole('combobox')).toHaveValue('Previous SLO-passing run');
    expect(
      screen.getByText('Each report compares against the most recent earlier run that passed its SLOs'),
    ).toBeInTheDocument();
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

    expect(
      screen.getByText('Each report compares against the run before it, so it never goes stale'),
    ).toBeInTheDocument();
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

  it('still hands back the whole candidate when a real run is picked', () => {
    // The synthetic entries are matched by id first; a real run must not be swallowed by
    // that lookup and must arrive with the fields the caller stores.
    const onChange = jest.fn();
    render(<BaselineRunSelect candidates={[candidate()]} onChange={onChange} />);

    fireEvent.click(within(openDropdown()).getAllByRole('option')[2]!);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        test_run_id: 'EA-acc-loadtest-00019',
        test_environment: 'acc',
        workload: 'loadTest',
      }),
    );
  });

  it('shows a real run with its timestamp, not a synthetic label', () => {
    render(<BaselineRunSelect candidates={[candidate()]} onChange={jest.fn()} />);

    const option = within(openDropdown()).getAllByRole('option')[2]!;
    expect(option).toHaveTextContent('EA-acc-loadtest-00019');
    expect(option).toHaveTextContent('acc / loadTest');
    expect(option).not.toHaveTextContent(/Previous/);
  });

  it('selects nothing for an empty value rather than falling into a sentinel', () => {
    // '' is falsy, so it must not be read as "some synthetic option"; an unsaved section
    // carries it and has to render as an empty picker.
    render(<BaselineRunSelect candidates={[candidate()]} value="" onChange={jest.fn()} />);

    expect(screen.getByRole('combobox')).toHaveValue('');
    expect(screen.getByText('Select from 1 available test runs')).toBeInTheDocument();
  });

  it('reports a cleared selection to the caller', () => {
    const onChange = jest.fn();
    render(
      <BaselineRunSelect candidates={[candidate()]} value={PREVIOUS_RUN_BASELINE} onChange={onChange} />,
    );

    // MUI only mounts the clear indicator once the field is focused.
    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.click(screen.getByTitle('Clear'));

    expect(onChange).toHaveBeenCalledWith(null);
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
      screen.queryByText('Each report compares against the run before it, so it never goes stale'),
    ).not.toBeInTheDocument();
  });
});

describe('BaselineRunSelect run ids that collide with Object.prototype', () => {
  // test_run_id is CI-supplied, so a run can genuinely be called "constructor". When the
  // synthetic options lived in an object literal, every one of these inherited a truthy value
  // from Object.prototype, took the synthetic branch and rendered a completely blank option —
  // and as a value it resolved to nothing, silently clearing the picker.
  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty'])(
    'renders a run named %s as a real run, not a blank option',
    (id) => {
      render(<BaselineRunSelect candidates={[candidate({ test_run_id: id })]} onChange={jest.fn()} />);

      const option = within(openDropdown()).getAllByRole('option')[2]!;
      expect(option).toHaveTextContent(id);
      expect(option).toHaveTextContent('acc / loadTest');
      expect(option).not.toHaveTextContent(/Previous/);
    },
  );

  it('selects such a run when it is the value, rather than clearing the picker', () => {
    render(
      <BaselineRunSelect
        candidates={[candidate({ test_run_id: 'toString' })]}
        value="toString"
        onChange={jest.fn()}
      />,
    );

    // The label is "<id> - <timestamp>"; the timestamp is locale/timezone dependent, so only
    // the id half is asserted.
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toMatch(/^toString - /);
    expect(screen.getByText('Comparing with: toString')).toBeInTheDocument();
  });

  it('hands the caller the real candidate when such a run is picked', () => {
    const onChange = jest.fn();
    render(
      <BaselineRunSelect candidates={[candidate({ test_run_id: 'constructor' })]} onChange={onChange} />,
    );

    fireEvent.click(within(openDropdown()).getAllByRole('option')[2]!);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ test_run_id: 'constructor', test_environment: 'acc' }),
    );
  });
});

describe('BaselineRunSelect option grouping', () => {
  it('separates the per-report sentinels from the pinnable runs', () => {
    render(<BaselineRunSelect candidates={[candidate()]} onChange={jest.fn()} />);
    const listbox = openDropdown();

    expect(within(listbox).getByText('Resolved per report')).toBeInTheDocument();
    expect(within(listbox).getByText('Specific runs')).toBeInTheDocument();

    const groups = Array.from(listbox.querySelectorAll<HTMLElement>('.MuiAutocomplete-groupUl'));
    expect(groups).toHaveLength(2);

    const sentinels = within(groups[0]!).getAllByRole('option');
    expect(sentinels).toHaveLength(2);
    expect(sentinels[0]).toHaveTextContent('Previous run');
    expect(sentinels[1]).toHaveTextContent('Previous SLO-passing run');

    const runs = within(groups[1]!).getAllByRole('option');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveTextContent('EA-acc-loadtest-00019');
  });

  it('shows no "Specific runs" group when the system has no earlier runs to pin', () => {
    render(<BaselineRunSelect candidates={[]} onChange={jest.fn()} />);
    const listbox = openDropdown();

    expect(within(listbox).getByText('Resolved per report')).toBeInTheDocument();
    expect(within(listbox).queryByText('Specific runs')).not.toBeInTheDocument();
  });
});
