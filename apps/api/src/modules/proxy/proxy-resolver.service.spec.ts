import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProxyResolverService } from './proxy-resolver.service';
import { ProxyServer } from '../../entities';

const mockOrgId = 'org-resolver-test';

const buildRepo = () => ({
  findOne: jest.fn(),
});

describe('ProxyResolverService', () => {
  let service: ProxyResolverService;
  let repo: ReturnType<typeof buildRepo>;

  beforeEach(async () => {
    repo = buildRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProxyResolverService,
        { provide: getRepositoryToken(ProxyServer), useValue: repo },
      ],
    }).compile();

    service = module.get<ProxyResolverService>(ProxyResolverService);
  });

  afterEach(() => jest.clearAllMocks());

  // ---------------------------------------------------------------- useProxy=false

  describe('resolve with useProxy=false', () => {
    it('returns null immediately without touching the repo', async () => {
      const result = await service.resolve(mockOrgId, false);
      expect(result).toBeNull();
      expect(repo.findOne).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------- useProxy=true, row present

  describe('resolve with useProxy=true and a row present', () => {
    it('calls findOne with the organizationId and returns ProxyAgents with dispatcher and axiosProxy', async () => {
      const row: Partial<ProxyServer> = {
        id: 'proxy-1',
        organizationId: mockOrgId,
        proxyUrl: 'http://p:3128',
      };
      repo.findOne.mockResolvedValue(row);

      const result = await service.resolve(mockOrgId, true);

      expect(repo.findOne).toHaveBeenCalledWith({ where: { organizationId: mockOrgId } });
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('dispatcher');
      expect(result).toHaveProperty('axiosProxy');
    });
  });

  // ---------------------------------------------------------------- useProxy=true, no row

  describe('resolve with useProxy=true and no row', () => {
    it('returns null when findOne resolves null', async () => {
      repo.findOne.mockResolvedValue(null);

      const result = await service.resolve(mockOrgId, true);

      expect(repo.findOne).toHaveBeenCalledWith({ where: { organizationId: mockOrgId } });
      expect(result).toBeNull();
    });
  });
});
