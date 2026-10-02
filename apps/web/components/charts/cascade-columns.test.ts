/**
 * The shared three-column picker's pure helpers.
 *
 * `CascadeColumns` is the chrome two very different cascades render — the test-run cards'
 * dashboards → panels → series picker and the report sections' metric selection — and
 * these three functions are the only logic in it. Both cascades' component tests exercise
 * them through the UI; these pin the edges that are awkward to reach from a render and
 * easy to break from inside the helper:
 *
 * - an EMPTY query matches everything. Returning `false` there would show an empty picker
 *   on first paint, which is how this reads as "no dashboards" rather than "no filter".
 * - an `undefined` field must not throw. A panel has no group heading, a dashboard has no
 *   panel title, and every row passes some of its fields as undefined.
 * - the count label says `12 / 90` only while filtering, so a reader can tell a narrowed
 *   list from a short one.
 */
import {
  cascadeCountLabel,
  cascadeGroupBy,
  cascadeMatchesQuery,
} from './CascadeColumns';

describe('cascadeMatchesQuery', () => {
  it('matches everything when nothing is typed, including blank-looking input', () => {
    expect(cascadeMatchesQuery('', 'JVM')).toBe(true);
    // The field trims, so a query of spaces is still "no filter" — not "nothing matches".
    expect(cascadeMatchesQuery('   ', 'JVM')).toBe(true);
    // Even a row with no readable field at all stays visible.
    expect(cascadeMatchesQuery('', undefined)).toBe(true);
  });

  it('is a case-insensitive substring match, with the query trimmed', () => {
    expect(cascadeMatchesQuery('jvm', 'JVM heap')).toBe(true);
    expect(cascadeMatchesQuery('  JvM  ', 'JVM heap')).toBe(true);
    expect(cascadeMatchesQuery('heap', 'JVM heap')).toBe(true);
    expect(cascadeMatchesQuery('zzz', 'JVM heap')).toBe(false);
  });

  it('searches every field it is given, so a source name finds its dashboards', () => {
    // The second field is the GROUP heading: typing "grafana" in the dashboards column
    // is how a reader picks out one source's dashboards.
    expect(cascadeMatchesQuery('grafana', 'JVM heap', 'Grafana')).toBe(true);
    // ...and a dashboard name typed into the panels column finds that dashboard's panels.
    expect(cascadeMatchesQuery('docker', 'CPU', 'Docker')).toBe(true);
  });

  it('skips an undefined field instead of throwing on it', () => {
    expect(cascadeMatchesQuery('jvm', undefined, 'JVM')).toBe(true);
    expect(cascadeMatchesQuery('jvm', undefined, undefined)).toBe(false);
    expect(cascadeMatchesQuery('jvm')).toBe(false);
  });
});

describe('cascadeCountLabel', () => {
  it('shows the total alone when nothing is filtered out', () => {
    expect(cascadeCountLabel('Dashboards', 90, 90)).toBe('Dashboards 90');
    expect(cascadeCountLabel('Series', 0, 0)).toBe('Series 0');
  });

  it('shows shown / total while filtering, so a narrowed list cannot read as a short one', () => {
    expect(cascadeCountLabel('Dashboards', 12, 90)).toBe('Dashboards 12 / 90');
    expect(cascadeCountLabel('Panels', 0, 7)).toBe('Panels 0 / 7');
  });
});

describe('cascadeGroupBy', () => {
  it('keeps groups in first-appearance order, so a repaint never reshuffles the list', () => {
    const rows = [
      { name: 'JVM', source: 'grafana' },
      { name: 'Perf', source: 'performance_test' },
      { name: 'Docker', source: 'grafana' },
    ];
    expect(cascadeGroupBy(rows, (r) => r.source)).toEqual([
      ['grafana', [rows[0], rows[2]]],
      ['performance_test', [rows[1]]],
    ]);
  });

  it('keeps each group members in their original order', () => {
    const rows = [{ id: 3 }, { id: 1 }, { id: 2 }];
    const [[, members]] = cascadeGroupBy(rows, () => 'one');
    expect(members!.map((m) => m.id)).toEqual([3, 1, 2]);
  });

  it('is empty for no items, rather than one empty group', () => {
    expect(cascadeGroupBy([], () => 'k')).toEqual([]);
  });

  it('folds an absent key into one group instead of dropping those rows', () => {
    // A dashboard that arrived via a SUT import has no metrics source, so its heading key
    // is ''. The rows still have to be listed.
    const rows = [{ name: 'A', source: '' }, { name: 'B', source: '' }];
    expect(cascadeGroupBy(rows, (r) => r.source)).toEqual([['', rows]]);
  });
});
