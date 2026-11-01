import { renderHook, act } from '@testing-library/react';
import { TAB, TAB_CARDS, useExpansionState } from '../useExpansionState';

describe('useExpansionState', () => {
  it('assigns every card to exactly one tab, so a re-click can collapse it', () => {
    // Value: protects=each ExpansionState key belongs to one tab's collapse list; fails_when=a new card key is added without a tab, or listed twice; why_new=nothing else ties the key set to TAB_CARDS; seam=none; no_claim=that a card renders on the tab it is listed under
    const { result } = renderHook(() => useExpansionState());
    const listed = Object.values(TAB_CARDS).flat();
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(Object.keys(result.current.expansionState).sort());
  });

  it('collapses only the given tab\'s cards', () => {
    // Value: protects=collapseTab leaves other tabs' expanded cards alone; fails_when=it resets every key; why_new=page test covers it through the DOM, this pins the hook contract; seam=none; no_claim=none beyond protects
    const { result } = renderHook(() => useExpansionState());
    act(() => {
      result.current.setExpansion('expanded', true);
      result.current.setExpansion('trendsExpanded', true);
    });
    act(() => result.current.collapseTab(TAB.results));
    expect(result.current.expansionState.expanded).toBe(false);
    expect(result.current.expansionState.trendsExpanded).toBe(true);
  });
});
