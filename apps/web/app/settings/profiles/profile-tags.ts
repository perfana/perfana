/**
 * Profile tags, and the three the UI does not show.
 *
 * A profile's tags are not decoration: auto-config matches them when it decides which dashboards
 * and SLOs a profile provisions, so losing one changes what a profile does. `PUT /profiles/:id`
 * REPLACES the array, so any editor that shows a filtered list and saves it would delete the tags
 * it never showed. That is what these two halves are for: `visibleProfileTags` is what an editor
 * may show, and `mergeSystemProfileTags` puts the hidden ones back before the save.
 *
 * **What these three actually are.** They are a DISPLAY CONVENTION inherited from the profiles
 * page, which has hidden them since before this module existed, not a set Perfana writes. Nothing
 * in this repository puts `perfana`, `perfana-template` or `no-anomaly-detection` onto
 * `profiles.tags`: the only writers of that column are `ProfilesService.createProfile` and
 * `updateProfile`, and the similarly-named constants elsewhere
 * (`PERFANA_TEMPLATE_TAG` in grafana-sync, `NO_ANOMALY_DETECTION_MARKER` in the worker,
 * `isSystemTag` in `@perfana/shared/utils`) all tag GRAFANA DASHBOARDS, with a broader
 * `/^perfana/i` rule. So on a profile these are ordinary tags that drive `profileMatchesRun` like
 * any other, and the preserve half currently defends a loss that cannot occur while the refuse
 * half is live. Keeping the hiding matches the two pre-existing display filters; whether a profile
 * should hide them at all is an open question, with the consequence that a profile stored with one
 * cannot have it removed through the UI. See TODOS.md, "The three hidden profile tags may not be Perfana's at all".
 *
 * Everything here compares and preserves tags EXACTLY, because the authority that decides what a
 * profile provisions does: `profileMatchesRun` (`@perfana/shared/utils/profile-match`) is a plain
 * `profileTags.includes(tag)`, case-sensitive and untrimmed. So `WERKNL` and `werknl` are two
 * different tags that can match two different runs, and `my app ` is not `my app`. An editor that
 * normalises spelling would silently change what the profile provisions — the same loss this
 * module exists to prevent, reached by rewriting instead of by dropping.
 */
export const SYSTEM_PROFILE_TAGS = ['perfana', 'perfana-template', 'no-anomaly-detection'] as const;

const SYSTEM_TAG_SET = new Set<string>(SYSTEM_PROFILE_TAGS);

/**
 * Is this one of the three hidden names, exactly?
 *
 * Deliberately NOT case-insensitive, and matched byte for byte. These three are only ever written
 * lowercase wherever they appear, and `profileMatchesRun` is case-sensitive, so a profile carrying
 * `Perfana` or ` perfana ` carries a tag that merely looks like one of them — and it drives
 * provisioning like any other. Hiding it would leave an operator unable to see a tag that changes
 * what the profile does, which is the opposite of what this module is for.
 */
export function isSystemProfileTag(tag: string): boolean {
  return SYSTEM_TAG_SET.has(tag);
}

/** The tags a user may see and edit: everything except the system ones. */
export function visibleProfileTags(tags: string[] | undefined): string[] {
  if (!tags) {return [];}
  return tags.filter(tag => !isSystemProfileTag(tag));
}

/**
 * The complete array to send to the API: what the user edited, plus every system tag the stored
 * profile carried.
 *
 * Order puts the system tags last and preserves their stored spelling, so a profile that round
 * trips through the dialog unchanged produces the same SET it started with, each tag byte for
 * byte — which is the only kind of "same" the matcher recognises. Not the same array: the API
 * never dedupes on write, so a stored `['foo','foo']` comes back as `['foo']`. Harmless to
 * `profileMatchesRun`'s `includes()`. A user who types a system tag by hand does not get it twice.
 *
 * Only tags the profile does NOT already carry are trimmed. Trimming is for the chip someone just
 * typed; applying it to a stored tag would rewrite a value the user never touched, and ` my app`
 * and `my app` select different runs.
 */
export function mergeSystemProfileTags(
  edited: string[],
  storedTags: string[] | undefined
): string[] {
  const stored = new Set(storedTags ?? []);
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const tag of edited) {
    const value = stored.has(tag) ? tag : tag.trim();
    // A blank chip is not a tag, and the API would store it as one.
    if (!value || isSystemProfileTag(value)) {continue;}
    // Exact dedupe: two tags differing only by case are two tags to `profileMatchesRun`, and
    // collapsing them would drop whichever the profile needed.
    if (seen.has(value)) {continue;}
    seen.add(value);
    cleaned.push(value);
  }

  const preserved = (storedTags ?? []).filter(isSystemProfileTag);
  return [...cleaned, ...preserved];
}
