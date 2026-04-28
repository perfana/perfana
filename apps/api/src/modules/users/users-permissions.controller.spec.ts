import { Test } from '@nestjs/testing';
import { UsersPermissionsController } from './users-permissions.controller';
import { AuthorizationService } from '../../common/services/authorization.service';

describe('UsersPermissionsController', () => {
  let controller: UsersPermissionsController;
  let authz: { getCapabilities: jest.Mock; getAccessibleOrganizations: jest.Mock };

  beforeEach(async () => {
    authz = {
      getCapabilities: jest.fn(),
      getAccessibleOrganizations: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [UsersPermissionsController],
      providers: [{ provide: AuthorizationService, useValue: authz }],
    }).compile();
    controller = moduleRef.get(UsersPermissionsController);
  });

  it('returns global capabilities + per-org capability map', async () => {
    authz.getCapabilities
      .mockResolvedValueOnce(['system:manage-users']) // global, organizationId=null
      .mockResolvedValueOnce(['integration:dynatrace:update']) // org-a
      .mockResolvedValueOnce(['test-run:read']); // org-b
    authz.getAccessibleOrganizations.mockResolvedValue(['org-a', 'org-b']);

    const result = await controller.getMyPermissions({
      userId: 'user-1',
      roles: ['perfana-user'],
    } as any);

    expect(result).toEqual({
      userId: 'user-1',
      global: ['system:manage-users'],
      byOrg: {
        'org-a': ['integration:dynatrace:update'],
        'org-b': ['test-run:read'],
      },
    });
  });

  it('returns empty byOrg when user has no org memberships', async () => {
    authz.getCapabilities.mockResolvedValueOnce([]);
    authz.getAccessibleOrganizations.mockResolvedValue([]);

    const result = await controller.getMyPermissions({
      userId: 'user-1',
      roles: ['perfana-user'],
    } as any);

    expect(result).toEqual({
      userId: 'user-1',
      global: [],
      byOrg: {},
    });
  });
});
