/**
 * AuthorizationService — API-key organization resolution
 *
 * Covers the `api-key:` branches of `isOrganizationMember` and
 * `getAccessibleOrganizations`, which resolve an API key's own
 * `organization_id` when the key has no `organization_members` row.
 *
 * REGRESSION GUARD: these two lookups were moved off `withRequestEm(...)`
 * (RLS-scoped) onto the plain injected repository. They are an *input* to the
 * RLS context — `getAccessibleOrganizations` becomes
 * `app.current_user_organizations`, which `rls_api_keys_select` then consumes —
 * so reading them through a policy that consumes them is circular and returns
 * zero rows for every API-key caller.
 *
 * The `withRequestEm` helper is identity-transparent when no request-scoped
 * EntityManager is in CLS, so the "unscoped" tests below deliberately install
 * one (mirroring RlsTransactionInterceptor) and assert the service still reads
 * through the plain repository. Reverting either call site to
 * `withRequestEm(...)` makes those two tests fail.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsServiceManager } from 'nestjs-cls';
import { Repository } from 'typeorm';
import { AuthorizationService } from '../authorization.service';
import { CapabilitiesService } from '../capabilities.service';
import { OrganizationMember, TeamMember, Team, ApiKey } from '@perfana/shared/entities';
import { REQ_EM } from '../../db/request-em';

describe('AuthorizationService — API-key organization resolution', () => {
  let service: AuthorizationService;
  let redis: jest.Mocked<any>;
  let organizationMemberRepository: jest.Mocked<Repository<OrganizationMember>>;
  let apiKeyRepository: jest.Mocked<Repository<ApiKey>>;

  // The RLS-scoped repository a request-scoped EntityManager would hand back.
  let scopedApiKeyRepository: jest.Mocked<Repository<ApiKey>>;
  let requestEm: { getRepository: jest.Mock };

  const apiKeyId = '723e4567-e89b-12d3-a456-426614174007';
  const apiKeyUserId = `api-key:${apiKeyId}`;
  const humanUserId = '123e4567-e89b-12d3-a456-426614174000';
  const organizationId = '223e4567-e89b-12d3-a456-426614174001';
  const otherOrganizationId = '323e4567-e89b-12d3-a456-426614174002';

  const cls = ClsServiceManager.getClsService();

  beforeEach(async () => {
    redis = {
      get: jest.fn(),
      setex: jest.fn(),
      del: jest.fn(),
      scan: jest.fn(),
      incr: jest.fn(),
    };

    scopedApiKeyRepository = {
      count: jest.fn().mockResolvedValue(0),
      findOne: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<Repository<ApiKey>>;

    requestEm = { getRepository: jest.fn().mockReturnValue(scopedApiKeyRepository) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthorizationService,
        CapabilitiesService,
        {
          provide: 'REDIS_CLIENT',
          useValue: redis,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              if (key === 'AUTH_CACHE_TTL_SECONDS') return 300;
              if (key === 'AUTH_CACHE_ENABLED') return 'true';
              return defaultValue;
            }),
          },
        },
        {
          provide: getRepositoryToken(OrganizationMember),
          useValue: { count: jest.fn(), findOne: jest.fn(), find: jest.fn() },
        },
        {
          provide: getRepositoryToken(TeamMember),
          useValue: { count: jest.fn(), findOne: jest.fn(), find: jest.fn() },
        },
        {
          provide: getRepositoryToken(Team),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(ApiKey),
          useValue: { count: jest.fn(), findOne: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<AuthorizationService>(AuthorizationService);
    organizationMemberRepository = module.get(getRepositoryToken(OrganizationMember));
    apiKeyRepository = module.get(getRepositoryToken(ApiKey));

    redis.get.mockResolvedValue(null);
    redis.setex.mockResolvedValue('OK');
    redis.del.mockResolvedValue(1);
    redis.scan.mockResolvedValue(['0', []]);
    redis.incr.mockResolvedValue(1);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // isOrganizationMember
  // =========================================================================

  describe('isOrganizationMember', () => {
    it('should return true when the API key itself belongs to the organization', async () => {
      organizationMemberRepository.count.mockResolvedValue(0);
      apiKeyRepository.count.mockResolvedValue(1);

      const result = await service.isOrganizationMember(apiKeyUserId, organizationId);

      expect(result).toBe(true);
      expect(apiKeyRepository.count).toHaveBeenCalledWith({
        where: { id: apiKeyId, organization_id: organizationId },
      });
      // The resolved answer is cached like any other membership result.
      expect(redis.setex).toHaveBeenCalled();
    });

    it('should return false when the API key belongs to a different organization', async () => {
      organizationMemberRepository.count.mockResolvedValue(0);
      apiKeyRepository.count.mockResolvedValue(0);

      const result = await service.isOrganizationMember(apiKeyUserId, otherOrganizationId);

      expect(result).toBe(false);
      expect(apiKeyRepository.count).toHaveBeenCalledWith({
        where: { id: apiKeyId, organization_id: otherOrganizationId },
      });
    });

    it('should not consult the API key table when the membership row already matched', async () => {
      organizationMemberRepository.count.mockResolvedValue(1);

      const result = await service.isOrganizationMember(apiKeyUserId, organizationId);

      expect(result).toBe(true);
      expect(apiKeyRepository.count).not.toHaveBeenCalled();
    });

    it('should not consult the API key table for a non-API-key user', async () => {
      organizationMemberRepository.count.mockResolvedValue(0);

      const result = await service.isOrganizationMember(humanUserId, organizationId);

      expect(result).toBe(false);
      expect(apiKeyRepository.count).not.toHaveBeenCalled();
    });

    it('should fail closed when the API key lookup throws', async () => {
      organizationMemberRepository.count.mockResolvedValue(0);
      apiKeyRepository.count.mockRejectedValue(new Error('Database error'));

      const result = await service.isOrganizationMember(apiKeyUserId, organizationId);

      expect(result).toBe(false);
      expect(redis.setex).not.toHaveBeenCalled();
    });

    it('REGRESSION: should read the API key through the plain repository, not the RLS-scoped one', async () => {
      organizationMemberRepository.count.mockResolvedValue(0);
      apiKeyRepository.count.mockResolvedValue(1);

      const result = await cls.run(async () => {
        cls.set(REQ_EM, requestEm as never);
        return service.isOrganizationMember(apiKeyUserId, organizationId);
      });

      expect(result).toBe(true);
      expect(apiKeyRepository.count).toHaveBeenCalledTimes(1);
      // withRequestEm(...) would have gone through the request EntityManager,
      // whose policy consumes the very answer this call produces.
      expect(requestEm.getRepository).not.toHaveBeenCalled();
      expect(scopedApiKeyRepository.count).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // getAccessibleOrganizations
  // =========================================================================

  describe('getAccessibleOrganizations', () => {
    it("should append the API key's own organization", async () => {
      organizationMemberRepository.find.mockResolvedValue([]);
      apiKeyRepository.findOne.mockResolvedValue({
        organization_id: organizationId,
      } as ApiKey);

      const result = await service.getAccessibleOrganizations(apiKeyUserId);

      expect(result).toEqual([organizationId]);
      expect(apiKeyRepository.findOne).toHaveBeenCalledWith({
        where: { id: apiKeyId },
        select: ['organization_id'],
      });
    });

    it("should not duplicate the API key's organization when membership already covers it", async () => {
      organizationMemberRepository.find.mockResolvedValue([
        { organization_id: organizationId },
        { organization_id: otherOrganizationId },
      ] as OrganizationMember[]);
      apiKeyRepository.findOne.mockResolvedValue({
        organization_id: organizationId,
      } as ApiKey);

      const result = await service.getAccessibleOrganizations(apiKeyUserId);

      expect(result).toEqual([organizationId, otherOrganizationId]);
    });

    it('should return memberships unchanged when the API key row is missing', async () => {
      organizationMemberRepository.find.mockResolvedValue([
        { organization_id: otherOrganizationId },
      ] as OrganizationMember[]);
      apiKeyRepository.findOne.mockResolvedValue(null);

      const result = await service.getAccessibleOrganizations(apiKeyUserId);

      expect(result).toEqual([otherOrganizationId]);
    });

    it('should not consult the API key table for a non-API-key user', async () => {
      organizationMemberRepository.find.mockResolvedValue([
        { organization_id: organizationId },
      ] as OrganizationMember[]);

      const result = await service.getAccessibleOrganizations(humanUserId);

      expect(result).toEqual([organizationId]);
      expect(apiKeyRepository.findOne).not.toHaveBeenCalled();
    });

    it('REGRESSION: should read the API key through the plain repository, not the RLS-scoped one', async () => {
      organizationMemberRepository.find.mockResolvedValue([]);
      apiKeyRepository.findOne.mockResolvedValue({
        organization_id: organizationId,
      } as ApiKey);

      const result = await cls.run(async () => {
        cls.set(REQ_EM, requestEm as never);
        return service.getAccessibleOrganizations(apiKeyUserId);
      });

      // This result *becomes* app.current_user_organizations. Reading it through
      // the request EM would resolve it against the GUCs it is meant to populate.
      expect(result).toEqual([organizationId]);
      expect(apiKeyRepository.findOne).toHaveBeenCalledTimes(1);
      expect(requestEm.getRepository).not.toHaveBeenCalled();
      expect(scopedApiKeyRepository.findOne).not.toHaveBeenCalled();
    });
  });
});
