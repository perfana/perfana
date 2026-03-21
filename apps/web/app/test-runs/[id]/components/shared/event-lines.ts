import type { PerfanaEvent } from '@/lib/events';

// Manual events: orange dotted lines
const EVENT_LINE_COLOR = 'rgba(255, 152, 0, 0.7)';
const EVENT_LINE_WIDTH = 1.5;

// Alerts: red solid lines
const ALERT_LINE_COLOR = 'rgba(244, 67, 54, 0.8)';
const ALERT_LINE_WIDTH = 1.5;

function isAlert(event: PerfanaEvent): boolean {
  return !!event.source && event.source !== 'manual';
}

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function buildHoverText(event: PerfanaEvent): string {
  const alert = isAlert(event);
  const lines = [`<b>${alert ? '\u26a0 ' : ''}${event.title}</b>`];
  if (alert && event.source) {
    lines.push(`Source: ${event.source}`);
  }
  lines.push(formatTimestamp(event.timestamp));
  if (event.description) {
    lines.push(`<i>${event.description}</i>`);
  }
  if (event.tags?.length) {
    lines.push(event.tags.join(', '));
  }
  return lines.join('<br>');
}

function getLineStyle(event: PerfanaEvent) {
  if (isAlert(event)) {
    return { color: ALERT_LINE_COLOR, width: ALERT_LINE_WIDTH, dash: 'solid' as const };
  }
  return { color: EVENT_LINE_COLOR, width: EVENT_LINE_WIDTH, dash: 'dot' as const };
}

function getAnnotationStyle(event: PerfanaEvent) {
  if (isAlert(event)) {
    return {
      font: { size: 10, color: '#b71c1c' },
      bgcolor: 'rgba(255, 235, 238, 0.9)',
      hoverlabel: {
        bgcolor: '#ffebee',
        bordercolor: '#f44336',
        font: { size: 12, color: '#333', family: 'Roboto, sans-serif' },
      },
    };
  }
  return {
    font: { size: 10, color: '#e65100' },
    bgcolor: 'rgba(255, 243, 224, 0.85)',
    hoverlabel: {
      bgcolor: '#fff3e0',
      bordercolor: '#ff9800',
      font: { size: 12, color: '#333', family: 'Roboto, sans-serif' },
    },
  };
}

export function createEventShapes(events: PerfanaEvent[]) {
  return events.map((event) => {
    const ts = new Date(event.timestamp);
    return {
      type: 'line' as const,
      xref: 'x' as const,
      yref: 'paper' as const,
      x0: ts,
      x1: ts,
      y0: 0,
      y1: 1,
      line: getLineStyle(event),
    };
  });
}

export function createEventAnnotations(events: PerfanaEvent[]) {
  return events.map((event) => {
    const style = getAnnotationStyle(event);
    return {
      x: new Date(event.timestamp),
      y: 1,
      xref: 'x' as const,
      yref: 'paper' as const,
      text: event.title,
      hovertext: buildHoverText(event),
      showarrow: false,
      font: style.font,
      textangle: -30,
      xanchor: 'left',
      yanchor: 'bottom',
      bgcolor: style.bgcolor,
      borderpad: 2,
      hoverlabel: style.hoverlabel,
    };
  });
}

export function mergeEventShapesIntoLayout(
  layout: Record<string, any>,
  events: PerfanaEvent[],
): Record<string, any> {
  if (!events || events.length === 0) return layout;

  return {
    ...layout,
    shapes: [...(layout.shapes || []), ...createEventShapes(events)],
    annotations: [...(layout.annotations || []), ...createEventAnnotations(events)],
  };
}

/**
 * For index-based x-axis charts (e.g. GraphsChart), find the closest index
 * for each event timestamp using binary search on sorted timestamps.
 */
function findClosestIndex(eventMs: number, sortedMs: number[]): number | null {
  if (sortedMs.length === 0) return null;
  if (eventMs <= sortedMs[0]) return 0;
  if (eventMs >= sortedMs[sortedMs.length - 1]) return sortedMs.length - 1;

  let lo = 0;
  let hi = sortedMs.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (sortedMs[mid] <= eventMs) lo = mid;
    else hi = mid;
  }
  // Return whichever is closer; interpolate between lo and hi
  const range = sortedMs[hi] - sortedMs[lo];
  if (range === 0) return lo;
  return lo + (eventMs - sortedMs[lo]) / range;
}

/**
 * Merge event annotations into an index-based chart layout.
 * sortedTimestamps: the chart's sorted timestamp strings from buildTimestampMapping.
 */
export function mergeEventShapesIntoIndexedLayout(
  layout: Record<string, any>,
  events: PerfanaEvent[],
  sortedTimestamps: string[],
): Record<string, any> {
  if (!events || events.length === 0 || sortedTimestamps.length === 0) return layout;

  const sortedMs = sortedTimestamps.map(ts => new Date(ts).getTime());

  const shapes: Record<string, any>[] = [];
  const annotations: Record<string, any>[] = [];

  for (const event of events) {
    const eventMs = new Date(event.timestamp).getTime();
    const idx = findClosestIndex(eventMs, sortedMs);
    if (idx === null) continue;

    const lineStyle = getLineStyle(event);
    const annStyle = getAnnotationStyle(event);

    shapes.push({
      type: 'line',
      xref: 'x',
      yref: 'paper',
      x0: idx,
      x1: idx,
      y0: 0,
      y1: 1,
      line: lineStyle,
    });

    annotations.push({
      x: idx,
      y: 1,
      xref: 'x',
      yref: 'paper',
      text: event.title,
      hovertext: buildHoverText(event),
      showarrow: false,
      font: annStyle.font,
      textangle: -30,
      xanchor: 'left',
      yanchor: 'bottom',
      bgcolor: annStyle.bgcolor,
      borderpad: 2,
      hoverlabel: annStyle.hoverlabel,
    });
  }

  return {
    ...layout,
    shapes: [...(layout.shapes || []), ...shapes],
    annotations: [...(layout.annotations || []), ...annotations],
  };
}
