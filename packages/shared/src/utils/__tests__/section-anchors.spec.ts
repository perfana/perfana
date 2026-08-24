import {
  slugifySectionTitle,
  assignSectionAnchors,
  findDuplicateTitles,
} from '../section-anchors';

describe('slugifySectionTitle', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifySectionTitle('SLO Results', 'slo')).toBe('slo-results');
  });

  it('collapses any run of non-alphanumerics into one hyphen', () => {
    expect(slugifySectionTitle('Apdex — checkout  (p95)', 'apdex')).toBe('apdex-checkout-p95');
  });

  it('strips accents rather than dropping the letters', () => {
    expect(slugifySectionTitle('Résumé Détails', 'x')).toBe('resume-details');
  });

  it('keeps digits', () => {
    expect(slugifySectionTitle('Top 10 Lists', 'top_10_lists')).toBe('top-10-lists');
  });

  it('trims leading and trailing separators', () => {
    expect(slugifySectionTitle('  --Trends--  ', 'trends')).toBe('trends');
  });

  it('falls back when the title has no alphanumerics at all', () => {
    expect(slugifySectionTitle('!!! ???', 'graphs')).toBe('graphs');
  });

  it('falls back on an empty title', () => {
    expect(slugifySectionTitle('', 'slo')).toBe('slo');
  });
});

describe('assignSectionAnchors', () => {
  const titleOf = (s: { title: string }) => s.title;
  const typeOf = (s: { type: string }) => s.type;

  it('gives each distinct title its own slug', () => {
    const a = { title: 'SLO Results', type: 'slo' };
    const b = { title: 'Trends', type: 'trends' };
    const map = assignSectionAnchors([a, b], titleOf, typeOf);
    expect(map.get(a)).toBe('slo-results');
    expect(map.get(b)).toBe('trends');
  });

  it('suffixes duplicates in document order, first keeps the bare slug', () => {
    const a = { title: 'Graphs', type: 'graphs' };
    const b = { title: 'Graphs', type: 'graphs' };
    const c = { title: 'Graphs', type: 'graphs' };
    const map = assignSectionAnchors([a, b, c], titleOf, typeOf);
    expect(map.get(a)).toBe('graphs');
    expect(map.get(b)).toBe('graphs-2');
    expect(map.get(c)).toBe('graphs-3');
  });

  it('does not let a suffixed slug collide with a real title', () => {
    // A section literally titled "Graphs 2" must not steal graphs-2.
    const a = { title: 'Graphs', type: 'graphs' };
    const b = { title: 'Graphs 2', type: 'graphs' };
    const c = { title: 'Graphs', type: 'graphs' };
    const map = assignSectionAnchors([a, b, c], titleOf, typeOf);
    expect(map.get(a)).toBe('graphs');
    expect(map.get(b)).toBe('graphs-2');
    expect(new Set([map.get(a), map.get(b), map.get(c)]).size).toBe(3);
  });

  it('returns an empty map for no sections', () => {
    expect(assignSectionAnchors([], titleOf, typeOf).size).toBe(0);
  });
});

describe('findDuplicateTitles', () => {
  it('reports a repeated title once', () => {
    expect(findDuplicateTitles(['Graphs', 'Trends', 'Graphs'])).toEqual(['Graphs']);
  });

  it('reports nothing when all titles are distinct', () => {
    expect(findDuplicateTitles(['Graphs', 'Trends'])).toEqual([]);
  });

  it('compares case-insensitively, since the slug does', () => {
    expect(findDuplicateTitles(['Graphs', 'graphs'])).toEqual(['Graphs']);
  });

  it('preserves first-appearance order across several duplicates', () => {
    expect(findDuplicateTitles(['B', 'A', 'B', 'A'])).toEqual(['B', 'A']);
  });
});
