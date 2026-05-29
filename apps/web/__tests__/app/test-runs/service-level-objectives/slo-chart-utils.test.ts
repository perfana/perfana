/**
 * Unit tests for buildChartLayout in slo-chart-utils.ts
 *
 * Verifies:
 * - No shapes when hasTimeSeriesData is false
 * - No shapes when both offsets are undefined
 * - Start rect + start line shapes when analysisStartOffset > 0
 * - Start line only (no rect) when analysisStartOffset === 0
 * - End rect + end line shapes when analysisEndOffset > 0
 * - End line only (no rect) when analysisEndOffset === 0
 * - safeEndBoundary clamp behaviour
 * - Correct timestamps on rect x0/x1 values
 * - Amber (#f59e0b) color on boundary lines
 * - layer: "above" on all shapes
 */

import { buildChartLayout } from '@/app/test-runs/[id]/components/service-level-objectives/utils/slo-chart-utils';
import type { ChartThemeColors } from '@/app/test-runs/[id]/components/service-level-objectives/types';

// A 1-hour test run: 10:00 → 11:00 UTC
const start = new Date('2024-01-01T10:00:00Z');
const end = new Date('2024-01-01T11:00:00Z'); // duration = 3600 s

const mockColors: ChartThemeColors = {
  excludedRegionColor: 'rgba(0,0,0,0.35)',
  plotBgColor: '#1e1e1e',
  bgColor: '#121212',
  textColor: '#fff',
  gridColor: '#333',
  dividerColor: '#444',
  textSecondary: '#aaa',
  sloColor: '#ef4444',
  hoverBgColor: '#222',
};

const FONT = 'Roboto';
const AMBER = '#f59e0b';

function getShapes(layout: Record<string, unknown>): unknown[] {
  return (layout.shapes as unknown[]) ?? [];
}

function isRect(s: unknown): boolean {
  return (s as { type: string }).type === 'rect';
}

function isLine(s: unknown): boolean {
  return (s as { type: string }).type === 'line';
}

describe('buildChartLayout', () => {
  describe('returns no shapes', () => {
    it('when hasTimeSeriesData is false', () => {
      const layout = buildChartLayout(false, start, end, 300, 60, 'ms', mockColors, FONT);
      expect(getShapes(layout)).toHaveLength(0);
    });

    it('when both offsets are undefined', () => {
      const layout = buildChartLayout(true, start, end, undefined, undefined, 'ms', mockColors, FONT);
      expect(getShapes(layout)).toHaveLength(0);
    });
  });

  describe('start offset shapes', () => {
    it('adds start rect + start line when analysisStartOffset > 0', () => {
      const layout = buildChartLayout(true, start, end, 300, undefined, 'ms', mockColors, FONT);
      const shapes = getShapes(layout);
      // Expect exactly: 1 rect + 1 line
      expect(shapes.filter(isRect)).toHaveLength(1);
      expect(shapes.filter(isLine)).toHaveLength(1);
      expect(shapes).toHaveLength(2);
    });

    it('adds start line but NOT start rect when analysisStartOffset === 0', () => {
      const layout = buildChartLayout(true, start, end, 0, undefined, 'ms', mockColors, FONT);
      const shapes = getShapes(layout);
      expect(shapes.filter(isRect)).toHaveLength(0);
      expect(shapes.filter(isLine)).toHaveLength(1);
      expect(shapes).toHaveLength(1);
    });

    it('does NOT add start shapes when analysisStartOffset is undefined', () => {
      const layout = buildChartLayout(true, start, end, undefined, undefined, 'ms', mockColors, FONT);
      expect(getShapes(layout)).toHaveLength(0);
    });
  });

  describe('end offset shapes', () => {
    it('adds end rect + end line when analysisEndOffset > 0', () => {
      const layout = buildChartLayout(true, start, end, undefined, 300, 'ms', mockColors, FONT);
      const shapes = getShapes(layout);
      expect(shapes.filter(isRect)).toHaveLength(1);
      expect(shapes.filter(isLine)).toHaveLength(1);
      expect(shapes).toHaveLength(2);
    });

    it('adds end line but NOT end rect when analysisEndOffset === 0', () => {
      const layout = buildChartLayout(true, start, end, undefined, 0, 'ms', mockColors, FONT);
      const shapes = getShapes(layout);
      expect(shapes.filter(isRect)).toHaveLength(0);
      expect(shapes.filter(isLine)).toHaveLength(1);
      expect(shapes).toHaveLength(1);
    });

    it('does NOT add end shapes when analysisEndOffset is undefined', () => {
      const layout = buildChartLayout(true, start, end, undefined, undefined, 'ms', mockColors, FONT);
      expect(getShapes(layout)).toHaveLength(0);
    });
  });

  describe('safeEndBoundary clamp', () => {
    it('clamps end shapes to startBoundary when endOffset pushes endBoundary before startBoundary', () => {
      // startOffset = 3000 s  → startBoundary = start + 3000s = 10:50
      // endOffset   = 4000 s  → endBoundary   = end  - 4000s  = 09:53 (before startBoundary!)
      // → safeEndBoundary should be startBoundary
      const startOffset = 3000;
      const endOffset = 4000;
      const startBoundary = new Date(start.getTime() + startOffset * 1000);

      const layout = buildChartLayout(true, start, end, startOffset, endOffset, 'ms', mockColors, FONT);
      const shapes = getShapes(layout);

      // end rect and end line exist (endOffset > 0)
      const rects = shapes.filter(isRect);
      const lines = shapes.filter(isLine);

      // There should be a start rect + start line + end rect + end line = 4 total
      expect(rects).toHaveLength(2);
      expect(lines).toHaveLength(2);

      // The end rect's x0 and the end line's x0/x1 should equal startBoundary
      const endRect = rects[1] as { x0: Date; x1: Date };
      const endLine = lines[1] as { x0: Date; x1: Date };

      expect(endRect.x0.getTime()).toBe(startBoundary.getTime());
      expect(endLine.x0.getTime()).toBe(startBoundary.getTime());
      expect(endLine.x1.getTime()).toBe(startBoundary.getTime());
    });
  });

  describe('rect x-boundaries', () => {
    it('start rect spans testRunStart → startBoundary', () => {
      const startOffset = 600; // 10 minutes
      const startBoundary = new Date(start.getTime() + startOffset * 1000);

      const layout = buildChartLayout(true, start, end, startOffset, undefined, 'ms', mockColors, FONT);
      const shapes = getShapes(layout);
      const rect = shapes.find(isRect) as { x0: Date; x1: Date };

      expect(rect.x0.getTime()).toBe(start.getTime());
      expect(rect.x1.getTime()).toBe(startBoundary.getTime());
    });

    it('end rect spans safeEndBoundary → testRunEnd', () => {
      const endOffset = 600; // 10 minutes
      const endBoundary = new Date(end.getTime() - endOffset * 1000);

      const layout = buildChartLayout(true, start, end, undefined, endOffset, 'ms', mockColors, FONT);
      const shapes = getShapes(layout);
      const rect = shapes.find(isRect) as { x0: Date; x1: Date };

      expect(rect.x0.getTime()).toBe(endBoundary.getTime());
      expect(rect.x1.getTime()).toBe(end.getTime());
    });
  });

  describe('styling', () => {
    it('amber boundary lines use #f59e0b color', () => {
      const layout = buildChartLayout(true, start, end, 300, 300, 'ms', mockColors, FONT);
      const shapes = getShapes(layout);
      const lines = shapes.filter(isLine) as Array<{ line: { color: string } }>;

      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line.line.color).toBe(AMBER);
      }
    });

    it('all shapes have layer: "above"', () => {
      const layout = buildChartLayout(true, start, end, 300, 300, 'ms', mockColors, FONT);
      const shapes = getShapes(layout) as Array<{ layer: string }>;

      expect(shapes.length).toBeGreaterThan(0);
      for (const shape of shapes) {
        expect(shape.layer).toBe('above');
      }
    });
  });
});
