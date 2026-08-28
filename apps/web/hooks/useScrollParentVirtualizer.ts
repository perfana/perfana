'use client';

import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/** Below this many rows, rendering the lot is cheaper than virtualising it. */
export const VIRTUALIZE_MIN_ROWS = 60;

export interface VirtualRow {
  index: number;
  /** Attach to the row element so the virtualiser can measure its real height. */
  measureRef?: (el: HTMLElement | null) => void;
}

/**
 * Virtualise a long list that lives inside the app's scrolling panel.
 *
 * Two things this gets right that the obvious implementation does not:
 *
 * 1. `useWindowVirtualizer` is the wrong tool here, and it fails *silently*. This
 *    app never scrolls the window: the layout puts the page inside
 *    `<main class="content-area">`, which owns the overflow, so window scrollY
 *    stays 0 forever. A window virtualiser renders its first slice and never
 *    hears about another scroll - the list just appears to end. So resolve the
 *    real scroll container by walking up to the nearest scrolling ancestor,
 *    rather than hard-coding `.content-area`, which a layout change would break
 *    in exactly the same silent way.
 *
 * 2. Short lists are not virtualised at all. Virtualising a dozen rows costs more
 *    than it saves, and it makes the component depend on layout measurement that
 *    jsdom cannot provide - which would mean the unit tests render an empty table
 *    and assert against nothing.
 *
 * `scrollMargin` is the list's offset inside the scroller. Without it the
 * virtualiser assumes the list starts at the top of the scroll container and
 * shows the wrong window of rows.
 */
export function useScrollParentVirtualizer({
  parentRef,
  count,
  estimateSize,
  overscan = 4,
  enabled,
}: {
  parentRef: RefObject<HTMLElement | null>;
  count: number;
  estimateSize: number;
  overscan?: number;
  /**
   * Override when the rendering cost is not proportional to `count`. The Apdex
   * table virtualises 17 scenario GROUPS but pays for the 292 transaction ROWS
   * inside them, so counting groups would switch virtualisation off exactly
   * where it is needed.
   */
  enabled?: boolean;
}): { rows: VirtualRow[]; padTop: number; padBottom: number; virtualized: boolean } {
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const virtualized = enabled ?? count >= VIRTUALIZE_MIN_ROWS;

  useEffect(() => {
    if (!virtualized) return;
    const list = parentRef.current;
    if (!list) return;

    let el: HTMLElement | null = list.parentElement;
    while (el) {
      const overflowY = getComputedStyle(el).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') break;
      el = el.parentElement;
    }

    setScrollElement(el);
    setScrollMargin(
      el ? list.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop : 0,
    );
  }, [parentRef, count, virtualized]);

  const getScrollElement = useCallback(() => scrollElement, [scrollElement]);

  // Always called - React forbids a conditional hook. When the list is short the
  // result is simply ignored in favour of the full range below.
  const virtualizer = useVirtualizer({
    count: virtualized ? count : 0,
    getScrollElement,
    estimateSize: () => estimateSize,
    overscan,
    scrollMargin,
  });

  const virtualItems = virtualizer.getVirtualItems();

  return useMemo(() => {
    if (!virtualized) {
      return {
        rows: Array.from({ length: count }, (_, index) => ({ index })),
        padTop: 0,
        padBottom: 0,
        virtualized: false,
      };
    }
    return {
      rows: virtualItems.map((item) => ({
        index: item.index,
        measureRef: virtualizer.measureElement,
      })),
      padTop: virtualItems.length > 0 ? virtualItems[0].start - scrollMargin : 0,
      padBottom:
        virtualItems.length > 0
          ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
          : 0,
      virtualized: true,
    };
    // virtualizer identity is stable; virtualItems is what actually changes.
  }, [virtualized, count, virtualItems, virtualizer, scrollMargin]);
}
