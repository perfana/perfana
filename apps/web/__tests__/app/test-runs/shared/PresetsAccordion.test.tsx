/**
 * The "Saved presets" accordion extracted out of the Compare, Trends and Graphs
 * cards. Its one non-obvious behaviour is `unmountOnExit`: the preset table is not
 * in the DOM at all until the accordion is opened. Compare already relied on that;
 * Trends and Graphs did not, and picked it up when they moved onto this component.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import PresetsAccordion from '@/app/test-runs/[id]/components/shared/PresetsAccordion';

describe('PresetsAccordion', () => {
  it('shows how many presets are saved', () => {
    render(
      <PresetsAccordion count={3} loading={false}>
        <div>rows</div>
      </PresetsAccordion>,
    );
    expect(screen.getByText('Saved presets (3)')).toBeInTheDocument();
  });

  it('shows a bare label while the count is still loading, never "(0)"', () => {
    render(
      <PresetsAccordion count={0} loading>
        <div>rows</div>
      </PresetsAccordion>,
    );
    expect(screen.getByText('Saved presets')).toBeInTheDocument();
    expect(screen.queryByText(/Saved presets \(/)).not.toBeInTheDocument();
  });

  // REGRESSION: without unmountOnExit MUI keeps the children mounted inside a
  // height:0 Collapse, so every preset row re-renders on each render of the card.
  // Callers must not assume the table is queryable while the accordion is shut.
  it('does not mount its children until it is opened', () => {
    render(
      <PresetsAccordion count={2} loading={false}>
        <div data-testid="preset-rows">rows</div>
      </PresetsAccordion>,
    );

    expect(screen.queryByTestId('preset-rows')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Saved presets (2)'));

    expect(screen.getByTestId('preset-rows')).toBeInTheDocument();
  });
});
