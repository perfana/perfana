import { render, screen } from '@testing-library/react';
import { SamplerTable } from '@/app/test-runs/[id]/components/performance-analysis/components/SamplerTable';
import { ParallelGroupStats, SamplerStat } from '@/app/test-runs/[id]/components/performance-analysis/types/performance-analysis.types';

function groupStats(overrides: Partial<ParallelGroupStats> = {}): ParallelGroupStats {
  return {
    parallel_group: 'PG1',
    executions: 40,
    passed_count: 40,
    failed_count: 0,
    avg_elapsed: 156,
    min_elapsed: 154,
    max_elapsed: 160,
    p95_elapsed: 159,
    p99_elapsed: 160,
    ...overrides,
  };
}

function sampler(name: string, overrides: Partial<SamplerStat> = {}): SamplerStat {
  return {
    sampler_name: name,
    avg_response_time: 10,
    min_response_time: 1,
    max_response_time: 20,
    p95_response_time: 18,
    p99_response_time: 19,
    passed_count: 5,
    failed_count: 0,
    total_count: 5,
    avg_latency: 1,
    avg_connect_time: 1,
    total_request_size: 1,
    total_response_size: 1,
    apdex_score: 1,
    active_threshold: 500,
    url_hash: null,
    url_pattern: null,
    ...overrides,
  };
}

function renderTable(samples: SamplerStat[]) {
  return render(
    <SamplerTable
      samples={samples}
      transactionName="T01_Add_To_Cart"
      onOpenSamplerActionMenu={jest.fn()}
      onOpenSamplerErrors={jest.fn()}
    />,
  );
}

describe('SamplerTable parallel groups', () => {
  it('renders a flat table with no band when nothing is tagged', () => {
    renderTable([sampler('a'), sampler('b')]);

    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
    expect(screen.queryByText(/Parallel group/i)).not.toBeInTheDocument();
  });

  it('bands grouped requests and names the group', () => {
    renderTable([
      sampler('cart_session_init'),
      sampler('one', { parallel_group: 'T01_Add_To_Cart_PG1' }),
      sampler('two', { parallel_group: 'T01_Add_To_Cart_PG1' }),
    ]);

    expect(screen.getByText('Parallel group')).toBeInTheDocument();
    expect(screen.getByText('T01_Add_To_Cart_PG1')).toBeInTheDocument();
    // The sequential sibling is still rendered as an ordinary row.
    expect(screen.getByText('cart_session_init')).toBeInTheDocument();
  });

  it('reports the group\'s own timings in the same columns as the requests', () => {
    const stats = groupStats();
    renderTable([
      sampler('slow', { parallel_group: 'PG1', parallel_group_stats: stats, avg_response_time: 158 }),
      sampler('fast', { parallel_group: 'PG1', parallel_group_stats: stats, avg_response_time: 7 }),
    ]);

    expect(screen.getByText('PG1')).toBeInTheDocument();
    // The group's measured elapsed time, not the sum or the max of its members.
    expect(screen.getByText('156.00')).toBeInTheDocument();
    expect(screen.getByText('159.00')).toBeInTheDocument();
    expect(screen.getByText('160.00')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
  });

  it('says why the timings are missing rather than looking broken', () => {
    // Two cases land here: a test still running (never analysed) and a run analysed before the
    // rollup existed. The wording has to be true of both.
    renderTable([
      sampler('one', { parallel_group: 'PG1' }),
      sampler('two', { parallel_group: 'PG1' }),
    ]);

    expect(screen.getByText('PG1')).toBeInTheDocument();
    expect(screen.getByText(/Timings appear once the run is analysed/)).toBeInTheDocument();
    // Must not claim the run was already analysed — that is false during a running test.
    expect(screen.queryByText(/was analysed before/)).not.toBeInTheDocument();
  });

  it('marks percentiles computed from too few executions', () => {
    const stats = groupStats({ executions: 4 });
    renderTable([
      sampler('one', { parallel_group: 'PG1', parallel_group_stats: stats }),
      sampler('two', { parallel_group: 'PG1', parallel_group_stats: stats }),
    ]);

    // A p95 over 4 observations is not a p95; the cell says so rather than implying otherwise.
    expect(screen.getAllByText('*').length).toBeGreaterThan(0);
  });

  it('does not band a group with a single member', () => {
    renderTable([sampler('lonely', { parallel_group: 'PG1' })]);

    expect(screen.getByText('lonely')).toBeInTheDocument();
    expect(screen.queryByText('Parallel group')).not.toBeInTheDocument();
  });

  it('gives each group its own colour so they can be told apart', () => {
    const { container } = renderTable([
      sampler('a', { parallel_group: 'PG1' }),
      sampler('b', { parallel_group: 'PG1' }),
      sampler('c', { parallel_group: 'PG2' }),
      sampler('d', { parallel_group: 'PG2' }),
    ]);

    const borderColors = Array.from(container.querySelectorAll('th'))
      .map((el) => window.getComputedStyle(el).borderLeftColor)
      .filter((c) => c && c !== '' && !/rgba\(0, 0, 0, 0\)/.test(c));

    // Two groups, two distinct accent colours.
    expect(new Set(borderColors).size).toBeGreaterThanOrEqual(2);
  });

  it('draws the group line only beside the request name', () => {
    // th:first-of-type only. Including td:first-of-type drew a second line down the Avg column,
    // because the name cell is a th so the first td is the next column along.
    const { container } = renderTable([
      sampler('a', { parallel_group: 'PG1' }),
      sampler('b', { parallel_group: 'PG1' }),
    ]);

    // Look at the member rows only — the band's own header cell is meant to carry the line.
    const memberRows = Array.from(container.querySelectorAll('tr')).filter((row) =>
      /^(a|b)$/.test(row.querySelector('th')?.textContent?.trim() ?? ''),
    );
    expect(memberRows).toHaveLength(2);

    for (const row of memberRows) {
      const bordered = Array.from(row.querySelectorAll('th,td')).filter(
        (el) => window.getComputedStyle(el).borderLeftWidth === '3px',
      );
      expect(bordered).toHaveLength(1);
      expect(bordered[0].tagName).toBe('TH');
    }
  });

  it('renders separate bands for separate groups', () => {
    renderTable([
      sampler('a', { parallel_group: 'PG1' }),
      sampler('b', { parallel_group: 'PG1' }),
      sampler('c', { parallel_group: 'PG2' }),
      sampler('d', { parallel_group: 'PG2' }),
    ]);

    expect(screen.getAllByText('Parallel group')).toHaveLength(2);
    expect(screen.getByText('PG1')).toBeInTheDocument();
    expect(screen.getByText('PG2')).toBeInTheDocument();
  });
});
