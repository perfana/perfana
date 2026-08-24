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

/** Slug a section title. `fallback` is used when the title has no alphanumerics. */
export function slugifySectionTitle(title: string, fallback: string): string {
  const slug = (title ?? '')
    // Decompose accented characters, then drop the combining marks, so "é" ends
    // up as "e" rather than being stripped along with the punctuation. The range
    // is written escaped because the literal characters are invisible in source.
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || fallback;
}

/**
 * Assign a unique anchor to every item, in document order.
 *
 * Duplicates get `-2`, `-3` … and the first occurrence keeps the bare slug. The
 * suffix is a fallback that keeps output deterministic; the contract is that
 * titles are unique, enforced by the warning `findDuplicateTitles` drives.
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
    anchors.set(item, candidate);
  }

  return anchors;
}

/**
 * Titles that appear more than once, each reported once, in first-appearance
 * order. Case-insensitive because the slug is.
 */
export function findDuplicateTitles(titles: string[]): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  const order: string[] = [];

  for (const title of titles) {
    const key = (title ?? '').trim().toLowerCase();
    if (seen.has(key)) {
      if (!duplicated.has(key)) {
        duplicated.add(key);
        order.push(titles.find(t => (t ?? '').trim().toLowerCase() === key) as string);
      }
    } else {
      seen.add(key);
    }
  }

  return order;
}
