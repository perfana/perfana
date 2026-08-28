import React, { useRef } from 'react';
import { renderHook } from '@testing-library/react';
import {
  useScrollParentVirtualizer,
  VIRTUALIZE_MIN_ROWS,
} from '@/hooks/useScrollParentVirtualizer';

/**
 * These cover the threshold contract, which is the part that decides whether a
 * table renders every row or a window of them. The virtualised path itself
 * cannot be covered here: jsdom performs no layout, so every element measures
 * zero and the virtualiser yields no items. That path is verified in a real
 * browser instead.
 *
 * The `enabled` override is the interesting case and the reason it exists. The
 * Apdex table virtualises 17 scenario GROUPS but pays for the ~292 transaction
 * ROWS inside them. Gating on its own item count switched virtualisation off in
 * exactly the case that needed it, and the SLO row expand regressed from 62ms to
 * 232ms. These assert the contract that prevents that from silently returning.
 */
const useHarness = (count: number, enabled?: boolean) => {
  const parentRef = useRef<HTMLDivElement>(null);
  return useScrollParentVirtualizer({ parentRef, count, estimateSize: 50, enabled });
};

describe('useScrollParentVirtualizer threshold', () => {
  it('renders every row for a list below the threshold', () => {
    const count = VIRTUALIZE_MIN_ROWS - 1;
    const { result } = renderHook(() => useHarness(count));

    expect(result.current.virtualized).toBe(false);
    expect(result.current.rows).toHaveLength(count);
    expect(result.current.rows.map((r) => r.index)).toEqual(
      Array.from({ length: count }, (_, i) => i),
    );
    // No spacers when nothing is windowed, or the table gains phantom height.
    expect(result.current.padTop).toBe(0);
    expect(result.current.padBottom).toBe(0);
  });

  it('does not attach a measuring ref when it is not virtualising', () => {
    // A stray ref would make the virtualiser cache heights it never uses.
    const { result } = renderHook(() => useHarness(3));
    expect(result.current.rows.every((r) => r.measureRef === undefined)).toBe(true);
  });

  it('switches on at the threshold', () => {
    const { result } = renderHook(() => useHarness(VIRTUALIZE_MIN_ROWS));
    expect(result.current.virtualized).toBe(true);
  });

  it('honours enabled:true for a short list whose cost is not its own count', () => {
    // The Apdex case: 17 groups, 292 rows. Without this the table renders all
    // 292 transactions at once and the row expand blocks for ~230ms.
    const { result } = renderHook(() => useHarness(17, true));
    expect(result.current.virtualized).toBe(true);
  });

  it('honours enabled:false for a long list', () => {
    const { result } = renderHook(() => useHarness(VIRTUALIZE_MIN_ROWS * 2, false));
    expect(result.current.virtualized).toBe(false);
    expect(result.current.rows).toHaveLength(VIRTUALIZE_MIN_ROWS * 2);
  });

  it('keeps the row set complete and in order when not virtualising', () => {
    // The non-virtualised branch is what every unit test in this repo renders
    // through, so a gap here would silently drop rows from the real tables.
    const { result } = renderHook(() => useHarness(12));
    expect(result.current.rows.map((r) => r.index)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });
});
