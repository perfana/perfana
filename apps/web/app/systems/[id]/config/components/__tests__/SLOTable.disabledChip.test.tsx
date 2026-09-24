/**
 * `duplicate()` clones an SLO **disabled** (v0.2.96.15) — that is what keeps the clone legal
 * under `uq_benchmarks_active_metric_target` until the user edits it into a variant. A
 * disabled SLO is skipped by the checks pipeline and produces no result on a run, which is
 * otherwise indistinguishable from a broken one, so the config table has to say so.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import SLOTable from '../SLOTable';
import type { Benchmark } from '../types';

const bm = (overrides: Partial<Benchmark>): Benchmark =>
  ({
    id: 'bm-1',
    system_under_test_id: 'sut-1',
    test_environment: 'production',
    workload: 'loadTest',
    source: 'grafana',
    benchmark_type: 'metric',
    config_title: 'Front end - Transaction Error Rate',
    panel_title: 'Transaction Error Rate',
    evaluate_type: 'avg',
    requirement_operator: 'lt',
    requirement_value: 5,
    enabled: true,
    valid: true,
    tags: [],
    ...overrides,
  }) as unknown as Benchmark;

function renderTable(benchmarks: Benchmark[]) {
  return render(
    <SLOTable
      benchmarks={benchmarks}
      searchText=""
      selectedTags={[]}
      selectedSloIds={new Set<string>()}
      onEdit={jest.fn()}
      onDuplicate={jest.fn()}
      onDelete={jest.fn()}
      onView={jest.fn()}
      onClearSearch={jest.fn()}
      onClearTags={jest.fn()}
      onSelectAll={jest.fn()}
      onSelectOne={jest.fn()}
    />,
  );
}

const rowFor = (title: string) => screen.getByText(title).closest('tr') as HTMLElement;

describe('SLOTable marks a disabled SLO', () => {
  it('shows a Disabled chip on the row and not on an enabled one', () => {
    renderTable([
      bm({ id: 'bm-on', config_title: 'Enabled SLO', enabled: true }),
      bm({ id: 'bm-off', config_title: 'Cloned SLO', enabled: false }),
    ]);

    expect(within(rowFor('Cloned SLO')).getByText('Disabled')).toBeInTheDocument();
    expect(within(rowFor('Enabled SLO')).queryByText('Disabled')).not.toBeInTheDocument();
  });

  // `enabled === false`, not a truthiness check: a row that carries no value at all is an
  // ordinary live SLO and must not be labelled as switched off.
  it('does not label a benchmark whose enabled flag is absent', () => {
    renderTable([bm({ id: 'bm-legacy', config_title: 'Legacy SLO', enabled: undefined as unknown as boolean })]);

    expect(screen.queryByText('Disabled')).not.toBeInTheDocument();
  });

  it('still renders the SLO name beside the chip', () => {
    renderTable([bm({ id: 'bm-off', config_title: 'Cloned SLO', enabled: false })]);

    const row = rowFor('Cloned SLO');
    expect(within(row).getByText('Disabled')).toBeInTheDocument();
    expect(within(row).getByText('Cloned SLO')).toBeInTheDocument();
  });

  // The chip must be a SIBLING of the name's Typography, not a child of it: `body2` renders
  // a <p> and Chip renders a <div>, and the HTML parser closes a <p> before a <div>. In CSR
  // the DOM API allows it and it only warns; in SSR the served markup differs from what
  // React builds, so the name drops onto its own line and hydration mismatches.
  it('does not nest the chip inside a paragraph', () => {
    const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = renderTable([
      bm({ id: 'bm-off', config_title: 'Cloned SLO', enabled: false }),
    ]);

    const chip = container.querySelector('.MuiChip-root[class*="MuiChip"]');
    expect(container.querySelector('p .MuiChip-root')).toBeNull();
    expect(chip?.closest('p')).toBeNull();

    const nestingWarnings = warn.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes('validateDOMNesting'));
    expect(nestingWarnings).toEqual([]);
    warn.mockRestore();
  });
});
