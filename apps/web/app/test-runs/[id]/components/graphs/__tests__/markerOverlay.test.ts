/**
 * Value: protects=marker pins land on their bucket, hide outside the view, stack on a shared bucket,
 * grey when deleted and fill when selected (design R14/DR10); fails_when=markerOverlay drops the
 * range check, the stacking offset or the click name the card resolves a pin by; seam=pure function;
 * no_claim=Plotly's rendering of the shapes.
 */
import { markerOverlay } from '../GraphsChart';
import type { RunComment } from '@/lib/test-run-comments';

const ts = ['2026-11-20T10:00:00Z', '2026-11-20T10:01:00Z', '2026-11-20T10:02:00Z', '2026-11-20T10:03:00Z'];
const m = (id: string, seq: number, time: string, deleted = false) =>
  ({ id, markerSeq: seq, markerTime: time, deleted }) as RunComment;
const base = { sortedTimestamps: ts, selectedId: null, draftTime: null, previewIndex: null, primary: '#0af', primaryText: '#fff', paper: '#000' };

describe('markerOverlay', () => {
  it('pins each visible marker on its nearest bucket, hides the rest, and stacks a shared bucket', () => {
    const { annotations, headroom } = markerOverlay({
      ...base,
      visibleRange: [1, 3],
      markers: [m('a', 1, '2026-11-20T10:00:10Z'), m('b', 2, '2026-11-20T10:01:50Z'), m('c', 3, '2026-11-20T10:02:05Z')],
    });
    expect(annotations.map((a) => [a.x, a.name, a.yshift])).toEqual([
      [2, 'comment-marker:b', 4],
      [2, 'comment-marker:c', 26],
    ]);
    // The top margin must clear the highest stacked pin (yshift 26 + a ~20px pin), or it is clipped.
    expect(headroom).toBeGreaterThanOrEqual(26 + 20);
  });

  it('asks for no extra top margin when no pin is drawn', () => {
    expect(markerOverlay({ ...base, visibleRange: [0, 3], markers: [] }).headroom).toBe(0);
  });

  it('greys a deleted marker, fills the selected one, and draws the pending pin unnumbered', () => {
    const { shapes, annotations } = markerOverlay({
      ...base,
      visibleRange: [0, 3],
      selectedId: 'b',
      draftTime: ts[3]!,
      markers: [m('a', 1, ts[0]!, true), m('b', 2, ts[1]!)],
    });
    expect(annotations[0]).toMatchObject({ opacity: 0.4, text: '<b>1</b>' });
    expect(annotations[1]).toMatchObject({ bgcolor: '#0af' });
    expect(annotations[2]).toMatchObject({ x: 3, text: '+' });
    expect(annotations[2]!.captureevents).toBeUndefined();
    expect(shapes.every((s) => (s.line as { dash: string }).dash === 'dash')).toBe(true);
  });
});
