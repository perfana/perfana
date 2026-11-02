import { renderHook, act } from '@testing-library/react';
import { TAB, tabOfCard, useExpansionState } from '../useExpansionState';

describe('useExpansionState drill-downs', () => {
  it('bumps only the drilled-into card\'s remount key, and switches to the RCA tab', () => {
    // Value: protects=each RCA drill-down remounts only its own card; fails_when=a handler bumps the other card's counter or none; why_new=testing review cycle 2: the Distributed Tracing key had no test; seam=none; no_claim=the card actually remounting (page keys it on this)
    const { result } = renderHook(() => useExpansionState());
    const setActiveTab = jest.fn();
    act(() => { result.current.handleDrillDownToDistributedTracing({ transaction: 'T01' }, TAB.results, setActiveTab); });
    expect(result.current.drillDownSeq).toEqual({ distributedTracing: 1, dynatrace: 0 });
    act(() => { result.current.handleDrillDownToDynatrace({ transaction: 'T01' }, TAB.results, setActiveTab); });
    expect(result.current.drillDownSeq).toEqual({ distributedTracing: 1, dynatrace: 1 });
    expect(setActiveTab).toHaveBeenCalledWith(TAB.rca);
  });

  it('finds the tab a card lives on', () => {
    // Value: protects=a link into a card switches to the tab that lists it; fails_when=tabOfCard falls through to Results for a listed card; why_new=revealCard now derives its tab from TAB_CARDS; seam=none; no_claim=none beyond protects
    expect(tabOfCard('graphsExpanded')).toBe(TAB.reporting);
    expect(tabOfCard('dynatraceExpanded')).toBe(TAB.rca);
    expect(tabOfCard('sloExpanded')).toBe(TAB.results);
  });
});
