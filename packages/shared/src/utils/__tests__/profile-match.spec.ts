import { matchProfilesForRun, profileMatchesRun } from '../profile-match';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

describe('profile matching', () => {
  it('matches on a shared tag inside the same organization', () => {
    expect(profileMatchesRun({ tags: ['jvm', 'x'], organizationId: ORG_A }, { tags: ['jvm'], organizationId: ORG_A })).toBe(true);
  });

  it('needs at least one shared tag', () => {
    expect(profileMatchesRun({ tags: ['jvm'], organizationId: ORG_A }, { tags: ['dotnet'], organizationId: ORG_A })).toBe(false);
    expect(profileMatchesRun({ tags: ['jvm'], organizationId: ORG_A }, { tags: [], organizationId: ORG_A })).toBe(false);
    expect(profileMatchesRun({ tags: null, organizationId: ORG_A }, { tags: ['jvm'], organizationId: ORG_A })).toBe(false);
    expect(profileMatchesRun({ tags: ['jvm'], organizationId: ORG_A }, { tags: null, organizationId: ORG_A })).toBe(false);
  });

  describe('fails closed across organizations', () => {
    it('never matches another organization’s profile, whatever the tags', () => {
      expect(profileMatchesRun({ tags: ['jvm'], organizationId: ORG_B }, { tags: ['jvm'], organizationId: ORG_A })).toBe(false);
    });

    it('a run with no organization matches no profile', () => {
      for (const organizationId of [null, undefined, '']) {
        expect(profileMatchesRun({ tags: ['jvm'], organizationId: ORG_A }, { tags: ['jvm'], organizationId })).toBe(false);
      }
    });

    it('a profile with no organization never matches', () => {
      for (const organizationId of [null, undefined, '']) {
        expect(profileMatchesRun({ tags: ['jvm'], organizationId }, { tags: ['jvm'], organizationId: ORG_A })).toBe(false);
      }
      // Not even a run that also lacks one: two missing organizations are not the same organization.
      expect(profileMatchesRun({ tags: ['jvm'], organizationId: null }, { tags: ['jvm'], organizationId: null })).toBe(false);
    });
  });

  it('filters a list, keeping its order', () => {
    const profiles = [
      { name: 'b', tags: ['jvm'], organizationId: ORG_A },
      { name: 'other-org', tags: ['jvm'], organizationId: ORG_B },
      { name: 'a', tags: ['jvm', 'prod'], organizationId: ORG_A },
      { name: 'no-org', tags: ['jvm'], organizationId: null },
    ];
    expect(matchProfilesForRun({ tags: ['jvm'], organizationId: ORG_A }, profiles).map((p) => p.name)).toEqual(['b', 'a']);
  });
});
