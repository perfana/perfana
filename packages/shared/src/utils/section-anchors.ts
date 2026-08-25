/**
 * Anchor slugs for report sections.
 *
 * Lives in shared because two consumers must produce byte-identical output: the
 * API stamps the anchors into the report HTML, and the web builder's link picker
 * has to compute the same slug or the markdown it inserts will not resolve. A
 * second implementation would drift, exactly as the section-type registry did.
 *
 * The slug is derived from the section TITLE, which makes the title the address.
 * That is a deliberate trade: no schema change and a guessable anchor, at the
 * cost of a rename breaking existing links. See the design doc.
 */

/**
 * The slug a title produces on its own, with no fallback applied — `''` when
 * nothing alphanumeric survives (a non-Latin script, emoji, or pure
 * punctuation). Exported so `findAnchorProblems` can tell "produced a real
 * slug that happens to collide with another" apart from "produced no slug at
 * all", a distinction `slugifySectionTitle` erases once it applies the
 * fallback.
 */
export function rawSlugOf(title: string): string {
  return (title ?? '')
    // Decompose accented characters, then drop the combining marks, so "é" ends
    // up as "e" rather than being stripped along with the punctuation. The range
    // is written escaped because the literal characters are invisible in source.
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Slug a section title. `fallback` is used when the title has no alphanumerics. */
export function slugifySectionTitle(title: string, fallback: string): string {
  return rawSlugOf(title) || fallback;
}

/**
 * Namespace prefix for every anchor `assignSectionAnchors` produces.
 *
 * A section anchor is slugged from an author-supplied title, which the author
 * does not know is sharing an id-space with anything else in the document.
 * Other renderers stamp their own ids from unrelated data — e.g. drill-down
 * table rows keyed off transaction names (`r-checkout`, `c-mid`, `b-reg`, see
 * report-interactivity.ts / comparisons-renderer.ts) — and a title like
 * "R Checkout" slugs to exactly `r-checkout`. Two elements sharing an id is
 * invalid HTML, and a browser resolves `#r-checkout` to whichever comes first
 * in DOM order, so a section link can silently land on a transaction row
 * instead of the section it names. This prefix is applied in the one place
 * that assigns section anchors, so the compiler's `id=`, the index renderer's
 * `href=`, and the web picker's inserted markdown all agree without each
 * having to know about the other id-producing renderers.
 */
export const SECTION_ANCHOR_PREFIX = 'section-';

/**
 * Assign a unique anchor to every item, in document order.
 *
 * Duplicates get `-2`, `-3` … and the first occurrence keeps the bare slug. The
 * suffix is a fallback that keeps output deterministic; the contract is that
 * base slugs are unique, enforced by the warning `findAnchorProblems` drives.
 * Every returned anchor carries `SECTION_ANCHOR_PREFIX` so it cannot collide
 * with an id some other report renderer stamps from unrelated data.
 */
export function assignSectionAnchors<T>(
  items: T[],
  titleOf: (item: T) => string,
  typeOf: (item: T) => string,
): Map<T, string> {
  const taken = new Set<string>();
  const anchors = new Map<T, string>();

  for (const item of items) {
    const base = slugifySectionTitle(titleOf(item), typeOf(item));
    let candidate = base;
    let n = 1;
    // Guard against a real title that already slugs to `base-2`: keep counting
    // until the candidate is genuinely free rather than assuming n=2 is.
    while (taken.has(candidate)) {
      n += 1;
      candidate = `${base}-${n}`;
    }
    taken.add(candidate);
    anchors.set(item, `${SECTION_ANCHOR_PREFIX}${candidate}`);
  }

  return anchors;
}

/**
 * The two distinct anchor hazards among a set of (already-effective, i.e.
 * blank-title-resolved) section titles.
 *
 * `slugCollisions` — base slugs (pre `-2`/`-3` suffix) that two or more
 * sections produce from a REAL slug (at least one `[a-z0-9]` survived), each
 * reported once, in first-appearance order. This is the hazard comparing
 * title STRINGS misses: "Graphs" and "graphs!" are different strings but the
 * same slug, so the first section to reorder or get deleted silently
 * repoints whatever links to the other. Actionable: give them distinct
 * titles.
 *
 * `titlelessSections` — sections whose title produced NO slug at all
 * (`rawSlugOf` returned `''`; a title written entirely in a non-Latin script,
 * emoji, or punctuation collapses this way). These are deliberately excluded
 * from `slugCollisions`: telling the author to "rename it" is not just
 * unhelpful advice here, it's actively wrong — ANY other title with no
 * `[a-z0-9]` characters collapses to the identical fallback, so two sections
 * of the same type written in, say, Chinese collide no matter what either is
 * renamed to (within that script). The real fact to report is that the
 * section's anchor is the section TYPE, positionally suffixed by
 * `assignSectionAnchors` — so it silently moves if a same-typed sibling is
 * added, removed, or reordered, title changes notwithstanding.
 */
export interface AnchorProblems<T> {
  slugCollisions: string[];
  titlelessSections: T[];
}

export function findAnchorProblems<T>(
  items: T[],
  titleOf: (item: T) => string,
  typeOf: (item: T) => string,
): AnchorProblems<T> {
  const titlelessSections: T[] = [];

  // Group by the same base slug assignSectionAnchors would compute (real slug,
  // or the type when the title produced none), tracking whether at least one
  // member of the group has a real (non-empty) slug of its own.
  const groups = new Map<string, { count: number; anyReal: boolean }>();
  const order: string[] = [];

  for (const item of items) {
    const raw = rawSlugOf(titleOf(item));
    if (!raw) {
      titlelessSections.push(item);
    }
    const base = raw || typeOf(item);

    const group = groups.get(base);
    if (group) {
      group.count += 1;
      group.anyReal = group.anyReal || Boolean(raw);
    } else {
      groups.set(base, { count: 1, anyReal: Boolean(raw) });
      order.push(base);
    }
  }

  // Only report a base as a slug collision when at least one contributing
  // title actually produced it (as opposed to falling back to it) — that is
  // the case a rename can fix. A base shared purely by titleless sections is
  // reported solely through `titlelessSections`, whose advice is different.
  const slugCollisions = order.filter(base => {
    const group = groups.get(base);
    return group !== undefined && group.count >= 2 && group.anyReal;
  });

  return { slugCollisions, titlelessSections };
}
