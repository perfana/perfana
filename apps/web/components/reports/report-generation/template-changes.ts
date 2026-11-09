import { getSectionText, type ReportSectionConfig } from '@/lib/api/reports';

/** JSON with object keys sorted, so two configs that differ only in key order compare equal. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, (v as Record<string, unknown>)[k]]),
      );
    }
    return v;
  });
}

/**
 * A comparable fingerprint of a report's sections: what a template would store and the report
 * would render, nothing else. The fields are normalised the way the builder writes them, so a
 * template loaded and left alone fingerprints the same as itself:
 *
 * - position in the array, never the stored `order`, which a stored template can disagree with
 *   and the builder renumbers on the first add or move;
 * - a blank title as no title (the builder stores whitespace-only input as undefined);
 * - the accompanying text through `getSectionText`, so a pre-2026-08-02 template's `comment`
 *   matches what the card shows, and an empty text as no text.
 */
export function sectionsFingerprint(sections: readonly ReportSectionConfig[]): string {
  return stableStringify(
    sections.map((s) => ({
      type: s.type,
      title: s.title?.trim() ? s.title : undefined,
      // `{}` and `{ key: undefined }` are no config, as the API would store them.
      config: s.config && stableStringify(s.config) !== '{}' ? s.config : undefined,
      text: getSectionText(s) || undefined,
    })),
  );
}
