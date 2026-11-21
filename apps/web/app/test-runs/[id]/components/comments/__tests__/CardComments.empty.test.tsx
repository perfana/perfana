import React, { useEffect, useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import CardComments from '../CardComments';

// A card that renders nothing (an integration that is not configured) must not leave its grid
// cell behind as an empty slot on the Root Cause Analysis tab.
const NullCard = () => null;
function LoadsThenHides() {
  const [loading, setLoading] = useState(true);
  useEffect(() => { const t = setTimeout(() => setLoading(false), 10); return () => clearTimeout(t); }, []);
  return loading ? <div>loading</div> : null;
}

it('hides the slot of a card that renders nothing', () => {
  render(<CardComments card="dynatraceExpanded" expanded={false}><NullCard /></CardComments>);
  expect(screen.getByTestId('comment-card-dynatraceExpanded')).toHaveStyle({ display: 'none' });
});

it('keeps the slot of a card that renders', () => {
  render(<CardComments card="dynatraceExpanded" expanded={false}><div>card</div></CardComments>);
  expect(screen.getByTestId('comment-card-dynatraceExpanded')).toHaveStyle({ display: 'flex' });
});

it('hides the slot once a card goes from loading to nothing', async () => {
  jest.useFakeTimers();
  render(<CardComments card="splunkExpanded" expanded={false}><LoadsThenHides /></CardComments>);
  const slot = screen.getByTestId('comment-card-splunkExpanded');
  expect(slot).toHaveStyle({ display: 'flex' });
  await act(async () => { jest.advanceTimersByTime(20); });
  expect(slot).toHaveStyle({ display: 'none' });
  jest.useRealTimers();
});
