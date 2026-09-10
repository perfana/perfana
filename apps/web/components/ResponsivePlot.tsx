'use client';

import type { PlotParams } from 'react-plotly.js';
import React, { useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { getPlotly, type PlotlyGraphDiv } from '@/lib/plotly';

const Plot = dynamic(() => import('@/components/plotly-cartesian'), { ssr: false });

/**
 * react-plotly.js 2.6.0's `useResizeHandler` only does
 * `window.addEventListener('resize', () => Plotly.Plots.resize(el))` — there is no
 * ResizeObserver in it. So a container that changes size without the window changing
 * leaves Plotly's cached geometry stale, and the hover label is then measured and
 * drawn against the old box (text and background box drift apart). Two such changes
 * exist in the anomaly-detection rows: the statistical drawer's 0.3s width
 * transition, and — Windows only — a classic scrollbar appearing and taking ~15px
 * off the container, which macOS overlay scrollbars never do.
 *
 * This does NOT cover a Collapse animating open: MUI clips a Collapse rather than
 * resizing its content, so the observed box keeps its final size throughout and the
 * observer fires only once, on `observe()`. The `onEntered` kicks on the Collapses
 * that wrap charts are still load-bearing — do not delete them as redundant.
 *
 * Resize THIS chart only. Dispatching a window resize instead (what
 * `kickPlotlyResize` does) wakes every Plotly listener on the page, and a drawer
 * transition emits an observer callback per animation frame — so one local
 * animation would relayout every unrelated chart, ~18 times over 300ms.
 */
export default function ResponsivePlot(props: PlotParams) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    // Without the guard, an environment lacking ResizeObserver throws inside the
    // effect and React blanks the whole page rather than losing one chart's resize.
    if (!el || typeof ResizeObserver === 'undefined') return;
    // No feedback loop: this div is sized by its parent, not by Plotly's output.
    const ro = new ResizeObserver(([entry]) => {
      // A hidden tab panel reports 0x0. Resizing to nothing is wasted work.
      if (!entry || entry.contentRect.width === 0) return;
      // No graph div means the lazy plotly chunk has not drawn yet; its first draw
      // measures the current size anyway. That same chunk (plotly.js/dist/plotly)
      // sets window.Plotly unconditionally, so getPlotly() resolves past this point.
      const gd = el.querySelector<PlotlyGraphDiv>('.js-plotly-plot');
      if (!gd) return;
      // Rejects when the div is hidden; nothing to do, and an unhandled rejection
      // would surface as a page error.
      getPlotly()?.Plots.resize(gd).catch(() => undefined);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ width: '100%', height: '100%' }}>
      <Plot {...props} />
    </div>
  );
}
