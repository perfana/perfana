import { buildCopyTargets } from '../components/AdaptTemplatesPanel';

jest.mock('@/lib/contexts/organization-context', () => ({ useOrganizationContext: jest.fn() }));

const ORG_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const ORG_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const orgs = [{ id: ORG_A, name: 'Acme' }, { id: ORG_B, name: 'Bravo' }];
const profiles = [{ id: 'p-tomcat', name: 'tomcat' }, { id: 'p-jvm', name: 'jvm' }];

describe('buildCopyTargets', () => {
  it('offers profiles by name, then the selected organization, install-wide for an admin, then the rest', () => {
    const labels = buildCopyTargets({ kind: 'organization', organizationId: ORG_B }, orgs, profiles, true, ORG_A).map((t) => t.label);
    expect(labels).toEqual(['Profile jvm', 'Profile tomcat', 'All runs in Acme', 'All runs on this install (install-wide)']);
  });

  it("never offers the template's own scope, where a copy would collide with it", () => {
    const fromProfile = buildCopyTargets({ kind: 'profile', profileId: 'p-jvm' }, orgs, profiles, false, ORG_A);
    expect(fromProfile.map((t) => t.key)).toEqual(['profile:p-tomcat', ORG_A, ORG_B]);
    expect(fromProfile[0]!.scope).toEqual({ kind: 'profile', profileId: 'p-tomcat' });

    const fromInstall = buildCopyTargets({ kind: 'install' }, orgs, [], true, ORG_A);
    expect(fromInstall.map((t) => t.key)).toEqual([ORG_A, ORG_B]);
  });
});
