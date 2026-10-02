/**
 * The add-series panel stays mounted while the picker is closed.
 *
 * It is what walks an "Open in Graphs / Trends" link's ?dashboard/panel/metric params, and
 * both of those cards start with their picker closed — unmounting it silently killed every
 * deeplink into them (v0.2.97.0).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AnalystChartCard from './AnalystChartCard';

const cardWith = (open: boolean, onToggle: () => void = () => {}) => (
  <AnalystChartCard
    title="Graphs"
    mode="light"
    addSeries={{ open, onToggle, panel: <div data-testid="cascade" /> }}
  >
    <div />
  </AnalystChartCard>
);

const card = (open: boolean) => render(cardWith(open));

it('renders the panel while closed, hidden rather than unmounted', () => {
  card(false);
  const panel = screen.getByTestId('cascade').parentElement!;
  expect(panel).toHaveStyle({ display: 'none' });
});

it('shows it when open', () => {
  card(true);
  expect(screen.getByTestId('cascade').parentElement!).not.toHaveStyle({ display: 'none' });
});

it('keeps the very same panel node across a close → open toggle', () => {
  // `display: none` is only half of it: the panel has to stay the SAME element, or React
  // remounts the cascade, its three-level walk restarts from nothing and — because a link
  // is consumed once per page load — the second mount finds it already spent.
  const { rerender } = render(cardWith(false));
  const before = screen.getByTestId('cascade');

  rerender(cardWith(true));
  expect(screen.getByTestId('cascade')).toBe(before);

  rerender(cardWith(false));
  expect(screen.getByTestId('cascade')).toBe(before);
});

it('mounts the panel on first render even though the picker starts closed', () => {
  // Graphs and Trends both render their card with the picker closed, so a panel that only
  // mounted on open would never run an effect at all. Proven by the child's own effect.
  const ran = jest.fn();
  const Probe = () => { React.useEffect(ran, []); return <div data-testid="cascade" />; };
  render(
    <AnalystChartCard title="Graphs" mode="light" addSeries={{ open: false, onToggle: () => {}, panel: <Probe /> }}>
      <div />
    </AnalystChartCard>,
  );

  expect(ran).toHaveBeenCalledTimes(1);
});

it('toggles the picker by hand, reporting its state on the button', () => {
  const onToggle = jest.fn();
  const { rerender } = render(cardWith(false, onToggle));
  const button = screen.getByRole('button', { name: '+ add series' });
  expect(button).toHaveAttribute('aria-expanded', 'false');

  fireEvent.click(button);
  expect(onToggle).toHaveBeenCalledTimes(1);

  // The state is the caller's, so the card only has to reflect it.
  rerender(cardWith(true, onToggle));
  expect(screen.getByRole('button', { name: '+ add series' })).toHaveAttribute('aria-expanded', 'true');
});

it('renders neither the toggle nor a panel for a card with no add-series slot', () => {
  // Compare's chart keeps its cascade outside the card and passes no slot at all.
  render(<AnalystChartCard title="Compare" mode="light"><div data-testid="plot" /></AnalystChartCard>);

  expect(screen.getByTestId('plot')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '+ add series' })).not.toBeInTheDocument();
  expect(screen.queryByTestId('cascade')).not.toBeInTheDocument();
});
