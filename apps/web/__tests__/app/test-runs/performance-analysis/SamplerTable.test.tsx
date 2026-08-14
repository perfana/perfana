import { render, screen } from '@testing-library/react';
import { SamplerTable } from '@/app/test-runs/[id]/components/performance-analysis/components/SamplerTable';
import { SamplerStat } from '@/app/test-runs/[id]/components/performance-analysis/types/performance-analysis.types';

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
    expect(screen.queryByText(/Wall clock/i)).not.toBeInTheDocument();
  });

  it('bands grouped requests and names the group', () => {
    renderTable([
      sampler('cart_session_init'),
      sampler('one', { parallel_group: 'T01_Add_To_Cart_PG1' }),
      sampler('two', { parallel_group: 'T01_Add_To_Cart_PG1' }),
    ]);

    expect(screen.getByText('Parallel group')).toBeInTheDocument();
    expect(screen.getByText('T01_Add_To_Cart_PG1')).toBeInTheDocument();
    expect(screen.getByText(/2 requests issued concurrently/)).toBeInTheDocument();
    // The sequential sibling is still rendered as an ordinary row.
    expect(screen.getByText('cart_session_init')).toBeInTheDocument();
  });

  it('reports wall clock as the slowest member', () => {
    renderTable([
      sampler('slow', { parallel_group: 'PG1', avg_response_time: 158 }),
      sampler('fast', { parallel_group: 'PG1', avg_response_time: 7 }),
    ]);

    // Approximate, and labelled as such — it is derived from per-request averages.
    const band = screen.getByText(/Wall clock/);
    expect(band).toHaveTextContent(/Wall clock ≈/);
    expect(band).toHaveTextContent(/158\.00 ms/);
    // The sequential comparison was dropped as noise — it must not come back.
    expect(band).not.toHaveTextContent(/if run sequentially/);
  });

  it('does not band a group with a single member', () => {
    renderTable([sampler('lonely', { parallel_group: 'PG1' })]);

    expect(screen.getByText('lonely')).toBeInTheDocument();
    expect(screen.queryByText('Parallel group')).not.toBeInTheDocument();
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
