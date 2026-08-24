import {
  slugifySectionTitle,
  assignSectionAnchors,
  findAnchorProblems,
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
  type Section = { title: string; type: string };
  const titleOf = (s: Section) => s.title;
  const typeOf = (s: Section) => s.type;

  it('gives each distinct title its own slug', () => {
    const a = { title: 'SLO Results', type: 'slo' };
    const b = { title: 'Trends', type: 'trends' };
    const map = assignSectionAnchors([a, b], titleOf, typeOf);
    expect(map.get(a)).toBe('section-slo-results');
    expect(map.get(b)).toBe('section-trends');
  });

  it('suffixes duplicates in document order, first keeps the bare slug', () => {
    const a = { title: 'Graphs', type: 'graphs' };
    const b = { title: 'Graphs', type: 'graphs' };
    const c = { title: 'Graphs', type: 'graphs' };
    const map = assignSectionAnchors([a, b, c], titleOf, typeOf);
    expect(map.get(a)).toBe('section-graphs');
    expect(map.get(b)).toBe('section-graphs-2');
    expect(map.get(c)).toBe('section-graphs-3');
  });

  it('does not let a suffixed slug collide with a real title', () => {
    // A section literally titled "Graphs 2" must not steal graphs-2.
    const a = { title: 'Graphs', type: 'graphs' };
    const b = { title: 'Graphs 2', type: 'graphs' };
    const c = { title: 'Graphs', type: 'graphs' };
    const map = assignSectionAnchors([a, b, c], titleOf, typeOf);
    expect(map.get(a)).toBe('section-graphs');
    expect(map.get(b)).toBe('section-graphs-2');
    expect(new Set([map.get(a), map.get(b), map.get(c)]).size).toBe(3);
  });

  it('returns an empty map for no sections', () => {
    expect(assignSectionAnchors([], titleOf, typeOf).size).toBe(0);
  });

  it('namespaces every anchor so it cannot collide with an id another renderer stamps from unrelated data', () => {
    // A section titled "R Checkout" slugs to the bare `r-checkout`, which is
    // exactly the id format report-interactivity.ts / comparisons-renderer.ts
    // stamp on drill-down rows keyed off transaction names. The prefix is the
    // fix: it must show up on every anchor, not just the colliding one.
    const a = { title: 'R Checkout', type: 'text_block' };
    const map = assignSectionAnchors([a], titleOf, typeOf);
    expect(map.get(a)).toBe('section-r-checkout');
    expect(map.get(a)).not.toBe('r-checkout');
  });
});

describe('findAnchorProblems', () => {
  type Section = { title: string; type: string };
  const titleOf = (s: Section) => s.title;
  const typeOf = (s: Section) => s.type;

  // Renamed from `findDuplicateTitles` and re-based on slug equality rather
  // than title-string equality: the hazard is the shared SLUG (what forces
  // the `-2` suffix and repoints links), not the title text. These first four
  // cases are the old `findDuplicateTitles` suite, ported to the new
  // slug-collision signal — a repeated title is still a slug collision, it's
  // just no longer the only way to get one.

  it('reports a repeated title once, as a slug collision', () => {
    const sections = [
      { title: 'Graphs', type: 'graphs' },
      { title: 'Trends', type: 'trends' },
      { title: 'Graphs', type: 'graphs' },
    ];
    const { slugCollisions, titlelessSections } = findAnchorProblems(sections, titleOf, typeOf);
    expect(slugCollisions).toEqual(['graphs']);
    expect(titlelessSections).toEqual([]);
  });

  it('reports nothing when all titles are distinct', () => {
    const sections = [
      { title: 'Graphs', type: 'graphs' },
      { title: 'Trends', type: 'trends' },
    ];
    expect(findAnchorProblems(sections, titleOf, typeOf).slugCollisions).toEqual([]);
  });

  it('compares case-insensitively, since the slug does', () => {
    const sections = [
      { title: 'Graphs', type: 'graphs' },
      { title: 'graphs', type: 'graphs' },
    ];
    expect(findAnchorProblems(sections, titleOf, typeOf).slugCollisions).toEqual(['graphs']);
  });

  it('preserves first-appearance order across several duplicates', () => {
    const sections = [
      { title: 'B', type: 'graphs' },
      { title: 'A', type: 'trends' },
      { title: 'B', type: 'graphs' },
      { title: 'A', type: 'trends' },
    ];
    expect(findAnchorProblems(sections, titleOf, typeOf).slugCollisions).toEqual(['b', 'a']);
  });

  // The case title-equality could never catch: different strings, same slug.
  it('catches a slug collision that title-string comparison would miss', () => {
    const sections = [
      { title: 'Graphs', type: 'graphs' },
      { title: 'graphs!', type: 'graphs' },
    ];
    const { slugCollisions, titlelessSections } = findAnchorProblems(sections, titleOf, typeOf);
    expect(slugCollisions).toEqual(['graphs']);
    expect(titlelessSections).toEqual([]);
  });

  // The other case title-equality could never catch: two DIFFERENT non-Latin
  // titles that both collapse to '' and fall back to the same section type.
  it('flags two distinct non-Latin titles that collide on the type fallback as titleless, not as a slug collision', () => {
    const sections = [
      { title: '图表一', type: 'graphs' }, // "Chart One"
      { title: '图表二', type: 'graphs' }, // "Chart Two" — a different title
    ];
    const { slugCollisions, titlelessSections } = findAnchorProblems(sections, titleOf, typeOf);
    // Not reported as a slug collision: renaming either title within the same
    // script would collapse to 'graphs' again, so "give them distinct titles"
    // would be wrong advice.
    expect(slugCollisions).toEqual([]);
    expect(titlelessSections).toEqual(sections);
  });

  it('reports a lone titleless section even with no collision', () => {
    const sections = [{ title: '图表', type: 'graphs' }];
    const { slugCollisions, titlelessSections } = findAnchorProblems(sections, titleOf, typeOf);
    expect(slugCollisions).toEqual([]);
    expect(titlelessSections).toEqual(sections);
  });

  it('reports neither signal for a clean report', () => {
    const sections = [
      { title: 'SLO Results', type: 'slo' },
      { title: 'Trends', type: 'trends' },
      { title: 'Custom Graphs', type: 'graphs' },
    ];
    const { slugCollisions, titlelessSections } = findAnchorProblems(sections, titleOf, typeOf);
    expect(slugCollisions).toEqual([]);
    expect(titlelessSections).toEqual([]);
  });

  it('does not blame a real title for colliding with an unrelated titleless fallback of a different type', () => {
    // 'trends' titled section vs a titleless 'graphs' section: different
    // fallback bases ('trends' vs 'graphs'), so no collision either way.
    const sections = [
      { title: 'Trends', type: 'trends' },
      { title: '图表', type: 'graphs' },
    ];
    const { slugCollisions, titlelessSections } = findAnchorProblems(sections, titleOf, typeOf);
    expect(slugCollisions).toEqual([]);
    expect(titlelessSections).toEqual([sections[1]]);
  });
});
