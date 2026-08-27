import { render, screen } from '@testing-library/react';
import { ApdexUnachievableNotice } from '../ApdexUnachievableNotice';

const item = (achievable: boolean, sample_count: number) => ({ achievable, sample_count });

const renderNotice = (items: ReturnType<typeof item>[], minSamples = 10) =>
  render(
    <ApdexUnachievableNotice items={items} minSamples={minSamples} defaultMinSamples={10} />,
  );

describe('ApdexUnachievableNotice', () => {
  it('renders nothing when every transaction has a threshold', () => {
    const { container } = renderNotice([item(true, 120), item(true, 40)]);
    expect(container).toBeEmptyDOMElement();
  });

  it('counts the transactions without a threshold', () => {
    renderNotice([item(true, 120), item(false, 7), item(false, 3)]);
    expect(screen.getByText(/2 transactions without a calculated threshold/)).toBeInTheDocument();
  });

  it('uses the singular for one transaction', () => {
    renderNotice([item(false, 7)]);
    expect(screen.getByText(/1 transaction without a calculated threshold/)).toBeInTheDocument();
  });

  it('suggests the largest skipped sample count so at least one row comes in', () => {
    renderNotice([item(false, 7), item(false, 3), item(false, 2)]);
    // 7 is the highest of the skipped counts: lowering to 7 includes exactly that one.
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Lower Min samples to 7');
    expect(alert.textContent).toContain('include one of them');
  });

  it('counts every row the suggested minimum would bring in', () => {
    renderNotice([item(false, 7), item(false, 7), item(false, 2)]);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Lower Min samples to 7');
    expect(alert.textContent).toContain('include 2 of them');
  });

  it('reflects a minimum the user already lowered', () => {
    renderNotice([item(false, 3), item(true, 12)], 5);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('fewer than 5 successful samples');
    expect(alert.textContent).toContain('Lower Min samples to 3');
  });

  it('does not offer the sample advice for a row that has enough samples', () => {
    // Not reachable through the current API, but the notice must not misexplain it.
    renderNotice([item(false, 500)]);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).not.toContain('Lower Min samples');
    expect(alert.textContent).toContain('hover the status chip');
  });
});
