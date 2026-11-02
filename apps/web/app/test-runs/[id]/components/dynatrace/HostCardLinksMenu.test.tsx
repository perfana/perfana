import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { useParams, useSearchParams } from 'next/navigation';
import HostCardLinksMenu from './HostCardLinksMenu';
import { OpenCardLinkContext } from '../shared/metric-card-links';

beforeEach(() => {
  (useParams as jest.Mock).mockReturnValue({ id: 'RUN-1' });
  (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
});

it('hands an "Open in …" click to the page without drilling the host row it sits in', () => {
  // Value: protects=a menu click inside the hosts table never reaches the row's onSelectHost; fails_when=the Menu stops stopping propagation (React bubbles portal clicks to the row); why_new=adversarial review: the hidden Dynatrace card was silently drilled into the host; seam=none; no_claim=the HostsOverviewTable wiring itself
  const onRowClick = jest.fn();
  const openCardLink = jest.fn();
  render(
    <OpenCardLinkContext.Provider value={openCardLink}>
      <table><tbody><tr onClick={onRowClick}><td><HostCardLinksMenu hostDisplayName="host-a" /></td></tr></tbody></table>
    </OpenCardLinkContext.Provider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Actions for host-a' }));
  fireEvent.click(screen.getByText('Open in Graphs'));
  expect(openCardLink).toHaveBeenCalledWith('graphs', { dashboardLabel: 'Dynatrace host metrics host-a' });
  expect(onRowClick).not.toHaveBeenCalled();
});
