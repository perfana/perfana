import { Test } from '@nestjs/testing';
import { CapabilitiesService } from './capabilities.service';
import { Capability } from '../../constants/capabilities.constants';
import { OrganizationRole, TeamRole } from '../../constants/roles.constants';

describe('CapabilitiesService', () => {
  let service: CapabilitiesService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [CapabilitiesService],
    }).compile();
    service = moduleRef.get(CapabilitiesService);
  });

  it('returns all capabilities for global admins', () => {
    const caps = service.compute({
      systemRoles: ['perfana-admin'],
      orgRoles: [],
      teamRoles: [],
    });
    expect(caps).toContain(Capability.IntegrationDynatraceUpdate);
    expect(caps).toContain(Capability.SystemManageUsers);
  });

  it('grants org-admin capabilities to org-admins', () => {
    const caps = service.compute({
      systemRoles: ['perfana-user'],
      orgRoles: [OrganizationRole.ADMIN],
      teamRoles: [],
    });
    expect(caps).toContain(Capability.IntegrationDynatraceUpdate);
    expect(caps).toContain(Capability.OrgManageMembers);
    expect(caps).not.toContain(Capability.SystemManageUsers);
  });

  it('grants only read+annotate to org-viewers (no integration mutate)', () => {
    const caps = service.compute({
      systemRoles: ['perfana-user'],
      orgRoles: [OrganizationRole.VIEWER],
      teamRoles: [],
    });
    expect(caps).toContain(Capability.TestRunRead);
    expect(caps).not.toContain(Capability.IntegrationDynatraceUpdate);
    expect(caps).not.toContain(Capability.OrgManageMembers);
  });

  it('grants org-member capabilities to org-members (no integration mutate)', () => {
    const caps = service.compute({
      systemRoles: ['perfana-user'],
      orgRoles: [OrganizationRole.MEMBER],
      teamRoles: [],
    });
    expect(caps).toContain(Capability.ProfileManage);
    expect(caps).toContain(Capability.TestRunUpdate);
    expect(caps).not.toContain(Capability.IntegrationDynatraceUpdate);
  });

  it('returns the union when user holds multiple roles', () => {
    const caps = service.compute({
      systemRoles: ['perfana-user'],
      orgRoles: [OrganizationRole.MEMBER, OrganizationRole.VIEWER],
      teamRoles: [TeamRole.ADMIN],
    });
    expect(caps).toContain(Capability.TestRunUpdate);
    expect(caps).toContain(Capability.TeamManageMembers);
  });

  it('returns no capabilities for unauthenticated/empty input', () => {
    const caps = service.compute({ systemRoles: [], orgRoles: [], teamRoles: [] });
    expect(caps).toEqual([]);
  });

  it('grants team-only capabilities when user has team role but no org membership', () => {
    const caps = service.compute({
      systemRoles: ['perfana-user'],
      orgRoles: [],
      teamRoles: [TeamRole.ADMIN],
    });
    expect(caps).toContain(Capability.TeamManageMembers);
    expect(caps).not.toContain(Capability.IntegrationDynatraceUpdate);
  });

  it('ignores unknown system roles (forward-compatible with new realm roles)', () => {
    const caps = service.compute({
      systemRoles: ['perfana-user', 'some-future-role-keycloak-added'],
      orgRoles: [OrganizationRole.MEMBER],
      teamRoles: [],
    });
    // Unknown role is silently dropped — only known mappings produce capabilities.
    expect(caps).toContain(Capability.TestRunUpdate); // from MEMBER mapping
    expect(caps).not.toContain(Capability.SystemManageUsers); // unknown role ≠ admin
  });
});
