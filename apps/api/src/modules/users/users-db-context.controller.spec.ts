import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UsersDbContextController } from './users-db-context.controller';
import * as requestEm from '../../common/db/request-em';

describe('UsersDbContextController', () => {
  let controller: UsersDbContextController;
  let configGet: jest.Mock;

  beforeEach(async () => {
    configGet = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersDbContextController],
      providers: [{ provide: ConfigService, useValue: { get: configGet } }],
    }).compile();
    controller = module.get(UsersDbContextController);
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns disabled when DB_ENABLE_RLS_ROLE=false', async () => {
    configGet.mockReturnValue('false');
    const result = await controller.dbContext();
    expect(result).toEqual({ rls: 'disabled', role: 'perfana', gucs: null });
  });

  it('returns error when no request EM is present', async () => {
    configGet.mockReturnValue('true');
    jest.spyOn(requestEm, 'getRequestEm').mockReturnValue(null);
    const result = await controller.dbContext();
    expect(result).toMatchObject({ rls: 'enabled', role: 'unknown', gucs: null });
    expect(result).toHaveProperty('error');
  });

  it('returns role + gucs when interceptor populated EM', async () => {
    configGet.mockReturnValue('true');
    const fakeEm = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ current_user: 'perfana_app' }])
        .mockResolvedValueOnce([
          {
            user_id: 'u1',
            organizations: '["org-A"]',
            teams: '[]',
            roles: '["user"]',
          },
        ]),
    };
    jest.spyOn(requestEm, 'getRequestEm').mockReturnValue(fakeEm as never);
    const result = await controller.dbContext();
    expect(result).toEqual({
      rls: 'enabled',
      role: 'perfana_app',
      gucs: {
        user_id: 'u1',
        organizations: '["org-A"]',
        teams: '[]',
        roles: '["user"]',
      },
    });
  });
});
