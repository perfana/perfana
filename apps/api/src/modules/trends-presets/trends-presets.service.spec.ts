/**
 * TrendsPresetsService — Phase 5a audit-logging assertions.
 *
 * Scope: this spec is intentionally scoped to the audit invariants added in
 * PR12. Broader CRUD coverage is tracked separately.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';
import { TrendsPresetsService } from './trends-presets.service';
import { TrendsFilterPreset } from '@perfana/shared/entities';
import { TestRun as TestRunEntity } from '../../entities';
import { AuditService } from '../audit/audit.service';

describe('TrendsPresetsService', () => {
  let service: TrendsPresetsService;
  let trendsPresetRepo: jest.Mocked<Repository<TrendsFilterPreset>>;
  let auditService: jest.Mocked<AuditService>;

  const mockUserId = 'user-trends-1';
  const mockOrgId = 'org-trends-1';

  const createMockPreset = (overrides?: Partial<TrendsFilterPreset>): TrendsFilterPreset => ({
    id: 'tp-1',
    name: 'My Trends',
    description: 'desc',
    presetType: 'generic',
    applicationDashboardId: 'ad-1',
    metricsSourceId: 'ms-1',
    panelId: 1,
    panelTitle: 'Latency',
    evaluateType: 'avg',
    source: 'grafana',
    dashboardLabel: 'Service A',
    seriesConfig: [],
    createdForTestRunId: undefined,
    isGlobal: false,
    organizationId: mockOrgId,
    teamId: undefined,
    createdBy: mockUserId,
    updatedBy: mockUserId,
    createdAt: new Date('2026-05-03T10:00:00Z'),
    updatedAt: new Date('2026-05-03T10:00:00Z'),
    ...overrides,
  } as TrendsFilterPreset);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrendsPresetsService,
        {
          provide: getRepositoryToken(TrendsFilterPreset),
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
            findOne: jest.fn().mockResolvedValue({
              testRunId: 'tr-mock',
              systemUnderTest: { organization_id: mockOrgId, team_id: undefined },
            }),
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

    service = module.get<TrendsPresetsService>(TrendsPresetsService);
    trendsPresetRepo = module.get(getRepositoryToken(TrendsFilterPreset));
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
      const created = createMockPreset({ id: 'tp-create' });
      trendsPresetRepo.create.mockReturnValue(created);
      trendsPresetRepo.save.mockResolvedValue(created);

      await service.create(
        {
          name: 'My Trends',
          preset_type: 'generic',
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
      const preset = createMockPreset({ id: 'tp-delete' });
      trendsPresetRepo.findOne.mockResolvedValue(preset);
      trendsPresetRepo.delete.mockResolvedValue({ affected: 1 } as never);

      await service.remove('tp-delete', mockUserId, true);

      expect(auditService.logDelete).toHaveBeenCalledTimes(1);
      expect(auditService.logDelete).toHaveBeenCalledWith(
        preset,
        { organizationIdOverride: mockOrgId },
      );
      expect(
        (auditService.logDelete as jest.Mock).mock.invocationCallOrder[0],
      ).toBeLessThan(
        (trendsPresetRepo.delete as jest.Mock).mock.invocationCallOrder[0],
      );
    });
  });
});
