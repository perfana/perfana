/**
 * GraphPresetsService — Phase 5a audit-logging assertions.
 *
 * Scope: this spec is intentionally scoped to the audit invariants added in
 * PR12. Broader CRUD coverage is tracked separately.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';
import { GraphPresetsService } from './graph-presets.service';
import { GraphPreset } from '@perfana/shared/entities';
import { TestRun as TestRunEntity } from '../../entities';
import { AuditService } from '../audit/audit.service';

describe('GraphPresetsService', () => {
  let service: GraphPresetsService;
  let graphPresetRepo: jest.Mocked<Repository<GraphPreset>>;
  let auditService: jest.Mocked<AuditService>;

  const mockUserId = 'user-graph-1';
  const mockOrgId = 'org-graph-1';

  const createMockPreset = (overrides?: Partial<GraphPreset>): GraphPreset => ({
    id: 'gp-1',
    name: 'My Graph',
    description: 'desc',
    testRunId: 'tr-1',
    userId: mockUserId,
    seriesConfig: [{ panelId: 1 } as never],
    chartOptions: undefined,
    isGlobal: false,
    organizationId: mockOrgId,
    teamId: undefined,
    createdBy: mockUserId,
    updatedBy: mockUserId,
    createdAt: new Date('2026-05-03T10:00:00Z'),
    updatedAt: new Date('2026-05-03T10:00:00Z'),
    ...overrides,
  } as GraphPreset);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GraphPresetsService,
        {
          provide: getRepositoryToken(GraphPreset),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(TestRunEntity),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: AuditService,
          useValue: {
            logCreate: jest.fn(),
            logUpdate: jest.fn(),
            logDelete: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<GraphPresetsService>(GraphPresetsService);
    graphPresetRepo = module.get(getRepositoryToken(GraphPreset));
    auditService = module.get(AuditService);

    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('audit logging (Phase 5a, PR12)', () => {
    it('logs CREATE with organizationIdOverride from the persisted preset', async () => {
      const created = createMockPreset({ id: 'gp-create' });
      graphPresetRepo.create.mockReturnValue(created);
      graphPresetRepo.save.mockResolvedValue(created);

      await service.create(
        {
          name: 'My Graph',
          seriesConfig: [{ panelId: 1 }],
        } as never,
        mockUserId,
      );

      expect(auditService.logCreate).toHaveBeenCalledTimes(1);
      expect(auditService.logCreate).toHaveBeenCalledWith(
        created,
        { organizationIdOverride: mockOrgId },
      );
    });

    it('logs DELETE before repository.delete', async () => {
      const preset = createMockPreset({ id: 'gp-delete' });
      graphPresetRepo.findOne.mockResolvedValue(preset);
      graphPresetRepo.delete.mockResolvedValue({ affected: 1 } as never);

      await service.remove('gp-delete', mockUserId, true);

      expect(auditService.logDelete).toHaveBeenCalledTimes(1);
      expect(auditService.logDelete).toHaveBeenCalledWith(
        preset,
        { organizationIdOverride: mockOrgId },
      );
      expect(
        (auditService.logDelete as jest.Mock).mock.invocationCallOrder[0],
      ).toBeLessThan(
        (graphPresetRepo.delete as jest.Mock).mock.invocationCallOrder[0],
      );
    });
  });
});
