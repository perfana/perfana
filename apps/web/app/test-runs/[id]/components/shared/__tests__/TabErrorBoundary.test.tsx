import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabErrorBoundary } from '../TabErrorBoundary';

it('contains a card\'s render error to its tab and recovers on "Try again"', () => {
  // Value: protects=a render error in a (possibly hidden) tab shows an inline message instead of taking the page down, and can be retried; fails_when=the boundary stops catching or the reset is lost; why_new=adversarial review: no error boundary existed and kept-mounted tabs widened the blast radius; seam=none; no_claim=Next's own error overlay in dev
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  let fail = true;
  const Card = () => { if (fail) throw new Error('boom'); return <span>card ok</span>; };
  render(<div><span>other tab</span><TabErrorBoundary><Card /></TabErrorBoundary></div>);
  expect(screen.getByText(/failed to render/)).toBeInTheDocument();
  expect(screen.getByText('other tab')).toBeInTheDocument();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(screen.getByText('card ok')).toBeInTheDocument();
  errorSpy.mockRestore();
});
