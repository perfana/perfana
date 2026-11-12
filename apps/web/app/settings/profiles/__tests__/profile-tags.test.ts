import {
  isSystemProfileTag,
  mergeSystemProfileTags,
  SYSTEM_PROFILE_TAGS,
  visibleProfileTags,
} from '../profile-tags';

/**
 * The profiles page hides Perfana's own tags, and `PUT /profiles/:id` REPLACES the tags array.
 * Those two facts together are the hazard these tests exist for: an editor that shows the
 * filtered list and saves it would delete the tags it never showed, and a profile's tags decide
 * which dashboards and SLOs it provisions.
 */
describe('visibleProfileTags', () => {
  it('hides every system tag and keeps the rest in order', () => {
    expect(visibleProfileTags(['perfana', 'frontend', 'perfana-template', 'api'])).toEqual([
      'frontend',
      'api',
    ]);
  });

  it('is empty for undefined and for a profile carrying only system tags', () => {
    expect(visibleProfileTags(undefined)).toEqual([]);
    expect(visibleProfileTags([...SYSTEM_PROFILE_TAGS])).toEqual([]);
  });

  it('matches a system tag EXACTLY, so a lookalike stays visible and editable', () => {
    // `profileMatchesRun` is case-sensitive, so `Perfana` is a user tag that drives provisioning
    // like any other. Hiding it would leave an operator unable to see a tag that matters.
    expect(visibleProfileTags(['Perfana', 'PERFANA-TEMPLATE', 'keep'])).toEqual([
      'Perfana',
      'PERFANA-TEMPLATE',
      'keep',
    ]);
    expect(isSystemProfileTag('no-anomaly-detection')).toBe(true);
    expect(isSystemProfileTag(' No-Anomaly-Detection ')).toBe(false);
    expect(isSystemProfileTag('perfana-ish')).toBe(false);
  });
});

describe('mergeSystemProfileTags', () => {
  it('puts back the system tags the editor never showed', () => {
    const stored = ['perfana', 'frontend', 'perfana-template'];
    // The user removed "frontend" and added "api". They never saw the other two.
    expect(mergeSystemProfileTags(['api'], stored)).toEqual([
      'api',
      'perfana',
      'perfana-template',
    ]);
  });

  it('round trips an untouched profile to the same set', () => {
    const stored = ['perfana', 'frontend', 'no-anomaly-detection'];
    const edited = visibleProfileTags(stored);
    expect(new Set(mergeSystemProfileTags(edited, stored))).toEqual(new Set(stored));
  });

  it('trims a newly typed tag but never a stored one', () => {
    // A padded chip someone just typed is a slip. A padded tag the profile already carries is
    // data: `my app ` and `my app` select different runs, so rewriting it changes provisioning.
    expect(mergeSystemProfileTags([' api '], [])).toEqual(['api']);
    expect(mergeSystemProfileTags(['my app '], ['my app '])).toEqual(['my app ']);
  });

  it('keeps two tags that differ only by case, because the matcher does', () => {
    // `profileMatchesRun` is `profileTags.includes(tag)`: WERKNL and werknl can match two
    // different runs, so collapsing them drops whichever the profile needed.
    const stored = ['WERKNL', 'werknl', 'perfana'];
    expect(mergeSystemProfileTags(visibleProfileTags(stored), stored)).toEqual([
      'WERKNL',
      'werknl',
      'perfana',
    ]);
  });

  it('drops blanks and exact duplicates the user typed', () => {
    expect(mergeSystemProfileTags([' api ', 'api', '', '   ', 'web'], [])).toEqual(['api', 'web']);
  });

  it('refuses a system tag typed by hand rather than storing it twice', () => {
    expect(mergeSystemProfileTags(['api', 'perfana'], ['perfana'])).toEqual(['api', 'perfana']);
    // And does not invent one the profile never had.
    expect(mergeSystemProfileTags(['api', 'perfana-template'], [])).toEqual(['api']);
  });

  it('returns only the user tags when the profile had no system tags', () => {
    expect(mergeSystemProfileTags(['a', 'b'], undefined)).toEqual(['a', 'b']);
  });
});
