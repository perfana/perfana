import { render, screen } from '@testing-library/react';
import { SamplerTable } from '@/app/test-runs/[id]/components/performance-analysis/components/SamplerTable';
import { ControllerRef, ParallelGroupStats, SamplerStat } from '@/app/test-runs/[id]/components/performance-analysis/types/performance-analysis.types';

const threadGroup: ControllerRef = { name: 'Shoppers', class: 'org.apache.jmeter.threads.ThreadGroup' };
const forEach = (name: string): ControllerRef => ({ name, class: 'org.apache.jmeter.control.ForeachController' });
const ifCtl = (name: string): ControllerRef => ({ name, class: 'org.apache.jmeter.control.IfController' });
const parallel = (name: string): ControllerRef => ({ name, class: 'org.apache.jmeter.control.ParallelController' });

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

  it('styles its headers the same way the transaction table does', () => {
    // The two tables sit one above the other; different header styling reads as a mistake.
    const { container } = renderTable([sampler('a')]);

    const headers = Array.from(container.querySelectorAll('thead th'));
    expect(headers.length).toBeGreaterThan(0);
    for (const th of headers) {
      const style = window.getComputedStyle(th);
      expect(style.textTransform).toBe('uppercase');
      expect(style.fontWeight).toBe('700');
    }
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

describe('SamplerTable controller bands', () => {
  it('bands a loop and explains the counts instead of inventing a duration', () => {
    renderTable([
      sampler('product_detail', {
        parent_controllers: [threadGroup, forEach('product_loop')],
        passed_count: 27,
        failed_count: 3,
      }),
    ]);

    expect(screen.getByText('Loop')).toBeInTheDocument();
    expect(screen.getByText('product_loop')).toBeInTheDocument();
    // The counts are real - they are the requests below, summed.
    expect(screen.getAllByText('27').length).toBeGreaterThan(0);
    expect(screen.getAllByText('3').length).toBeGreaterThan(0);
    // Nothing measures how long a loop takes, so it is never labelled as a parallel group.
    expect(screen.queryByText('Parallel group')).not.toBeInTheDocument();
  });

  it('labels a conditional so a lower count does not read as a bug', () => {
    renderTable([
      sampler('even_thread_extra', {
        parent_controllers: [threadGroup, ifCtl('even_threads_only')],
      }),
    ]);

    expect(screen.getByText('Conditional')).toBeInTheDocument();
    expect(screen.getByText('even_threads_only')).toBeInTheDocument();
  });

  it('nests a parallel band inside the loop that drives it', () => {
    const { container } = renderTable([
      sampler('product_detail', { parent_controllers: [threadGroup, forEach('product_loop')] }),
      sampler('asset_css', {
        parent_controllers: [threadGroup, forEach('product_loop'), parallel('PG1')],
      }),
      sampler('asset_js', {
        parent_controllers: [threadGroup, forEach('product_loop'), parallel('PG1')],
      }),
    ]);

    expect(screen.getByText('Loop')).toBeInTheDocument();
    expect(screen.getByText('Parallel group')).toBeInTheDocument();

    const rowText = Array.from(container.querySelectorAll('tbody tr')).map(
      (r) => r.textContent ?? '',
    );
    const loopAt = rowText.findIndex((t) => t.includes('product_loop'));
    const pgAt = rowText.findIndex((t) => t.includes('PG1'));
    const assetAt = rowText.findIndex((t) => t.includes('asset_css'));
    // Outer band, then the nested band, then the nested band's requests.
    expect(loopAt).toBeLessThan(pgAt);
    expect(pgAt).toBeLessThan(assetAt);
  });

  it('says what the parallel group would have cost one request after another', () => {
    // The whole point of the band: 240 ms of work the user waited 100 ms for.
    const stats = groupStats({ executions: 10, avg_elapsed: 100 });
    renderTable([
      sampler('a', { parallel_group: 'PG1', parallel_group_stats: stats, avg_response_time: 90, total_count: 10 }),
      sampler('b', { parallel_group: 'PG1', parallel_group_stats: stats, avg_response_time: 80, total_count: 10 }),
      sampler('c', { parallel_group: 'PG1', parallel_group_stats: stats, avg_response_time: 70, total_count: 10 }),
    ]);

    expect(screen.getByText(/240\.00 ms if serial/)).toBeInTheDocument();
    expect(screen.getByText(/2\.4/)).toBeInTheDocument();
  });

  it('weights a request that fires more than once per execution of the group', () => {
    // 20 firings over 10 executions is twice per execution, so it costs twice per execution.
    const stats = groupStats({ executions: 10, avg_elapsed: 100 });
    renderTable([
      sampler('twice', { parallel_group: 'PG1', parallel_group_stats: stats, avg_response_time: 100, total_count: 20 }),
      sampler('once', { parallel_group: 'PG1', parallel_group_stats: stats, avg_response_time: 50, total_count: 10 }),
    ]);

    expect(screen.getByText(/250\.00 ms if serial/)).toBeInTheDocument();
  });

  it('claims no saving when the requests barely overlapped', () => {
    // Serial 102 against a wall of 100 is noise, not concurrency worth announcing.
    const stats = groupStats({ executions: 10, avg_elapsed: 100 });
    renderTable([
      sampler('a', { parallel_group: 'PG1', parallel_group_stats: stats, avg_response_time: 51, total_count: 10 }),
      sampler('b', { parallel_group: 'PG1', parallel_group_stats: stats, avg_response_time: 51, total_count: 10 }),
    ]);

    expect(screen.queryByText(/if serial/)).not.toBeInTheDocument();
  });

  it('omits the comparison entirely when the run has not been analysed', () => {
    // No measured wall time means no honest ratio to show.
    renderTable([
      sampler('a', { parallel_group: 'PG1', avg_response_time: 90 }),
      sampler('b', { parallel_group: 'PG1', avg_response_time: 80 }),
    ]);

    expect(screen.queryByText(/if serial/)).not.toBeInTheDocument();
    expect(screen.getByText(/Timings appear once the run is analysed/)).toBeInTheDocument();
  });
});
