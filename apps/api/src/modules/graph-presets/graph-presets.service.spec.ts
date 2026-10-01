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
  let testRunRepo: { findOne: jest.Mock };
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

    service = module.get<GraphPresetsService>(GraphPresetsService);
    graphPresetRepo = module.get(getRepositoryToken(GraphPreset));
    testRunRepo = module.get(getRepositoryToken(TestRunEntity));
    auditService = module.get(AuditService);

    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // REGRESSION: the graphs card PATCHes /graph-presets/:id whenever a preset of the same
  // name already exists, but no PATCH route existed — that save path 404'd silently.
  describe('update', () => {
    it('applies only the supplied fields and audits the change', async () => {
      const existing = createMockPreset({ id: 'gp-1', userId: mockUserId, name: 'Old' });
      graphPresetRepo.findOne.mockResolvedValue(existing);
      graphPresetRepo.save.mockImplementation(async (p) => p as never);

      const result = await service.update('gp-1', { name: 'New' }, mockUserId, false, [mockOrgId]);

      expect(result.name).toBe('New');
      expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
    });

    it('refuses to update someone else\'s preset', async () => {
      graphPresetRepo.findOne.mockResolvedValue(createMockPreset({ id: 'gp-1', userId: 'someone-else' }));

      await expect(service.update('gp-1', { name: 'New' }, mockUserId, false, [mockOrgId]))
        .rejects.toThrow('You can only update your own presets');
      expect(graphPresetRepo.save).not.toHaveBeenCalled();
    });

    it('lets a global admin update any preset', async () => {
      const existing = createMockPreset({ id: 'gp-1', userId: 'someone-else' });
      graphPresetRepo.findOne.mockResolvedValue(existing);
      graphPresetRepo.save.mockImplementation(async (p) => p as never);

      await expect(service.update('gp-1', { name: 'New' }, mockUserId, true, [mockOrgId])).resolves.toBeDefined();
    });

    it('rejects an empty series configuration', async () => {
      graphPresetRepo.findOne.mockResolvedValue(createMockPreset({ id: 'gp-1', userId: mockUserId }));

      await expect(service.update('gp-1', { seriesConfig: [] }, mockUserId, false, [mockOrgId]))
        .rejects.toThrow('Series configuration cannot be empty');
    });

    // PartialType means an absent key is "leave it alone" and an explicit value is a
    // write — including `isGlobal: false`, which a `if (dto.isGlobal)` check would drop.
    it('writes every supplied field and leaves the untouched ones alone', async () => {
      const existing = createMockPreset({
        id: 'gp-1',
        userId: mockUserId,
        name: 'Old',
        description: 'keep me',
        isGlobal: true,
        testRunId: 'tr-1',
      });
      graphPresetRepo.findOne.mockResolvedValue(existing);
      graphPresetRepo.save.mockImplementation(async (p) => p as never);

      const result = await service.update(
        'gp-1',
        {
          name: 'New',
          seriesConfig: [{ panelId: 7 }],
          chartOptions: { yAxis: 'log' },
          isGlobal: false,
        } as never,
        'someone-else',
        true,
      );

      expect(result.name).toBe('New');
      expect(result.description).toBe('keep me');
      expect(result.isGlobal).toBe(false);
      expect(result.seriesConfig).toEqual([{ panelId: 7 }]);
      expect(result.chartOptions).toEqual({ yAxis: 'log' });
      // An update must never re-home the preset to another system.
      expect(graphPresetRepo.save.mock.calls[0]![0]).toMatchObject({
        testRunId: 'tr-1',
        organizationId: mockOrgId,
        updatedBy: 'someone-else',
      });
    });

    // PartialType stamps @IsOptional() on every property, and class-validator's
    // @IsOptional() skips null as well as undefined — so an explicit null reached the
    // save and came back as a 500 carrying the raw Postgres NOT NULL error.
    it.each(['name', 'seriesConfig', 'isGlobal'])(
      'rejects an explicit null for %s rather than writing it',
      async (field) => {
        graphPresetRepo.findOne.mockResolvedValue(createMockPreset({ id: 'gp-1', userId: mockUserId }));

        await expect(
          service.update('gp-1', { [field]: null } as never, mockUserId, false, [mockOrgId]),
        ).rejects.toThrow(`${field} cannot be null`);
        expect(graphPresetRepo.save).not.toHaveBeenCalled();
      },
    );

    it('clears description on an explicit null, which is a nullable column', async () => {
      graphPresetRepo.findOne.mockResolvedValue(
        createMockPreset({ id: 'gp-1', userId: mockUserId, description: 'old' }),
      );
      graphPresetRepo.save.mockImplementation(async (p) => p as never);

      await service.update('gp-1', { description: null } as never, mockUserId, false, [mockOrgId]);

      expect(graphPresetRepo.save.mock.calls[0]![0]).toMatchObject({ description: null });
    });

    // findAll's non-global arm is `preset.testRunId = :testRunId`, so narrowing a
    // legacy preset whose test_run_id is NULL would match no arm on any run: gone from
    // every list, and testRunId is not updatable, so it could never be undone.
    it('refuses to make a preset run-specific when it has no run to scope to', async () => {
      graphPresetRepo.findOne.mockResolvedValue(
        createMockPreset({ id: 'gp-1', userId: mockUserId, testRunId: undefined }),
      );

      await expect(
        service.update('gp-1', { isGlobal: false }, mockUserId, false, [mockOrgId]),
      ).rejects.toThrow('no test run to scope to');
      expect(graphPresetRepo.save).not.toHaveBeenCalled();
    });

    it('allows isGlobal: false when the preset does have a run', async () => {
      graphPresetRepo.findOne.mockResolvedValue(
        createMockPreset({ id: 'gp-1', userId: mockUserId, testRunId: 'run-1' }),
      );
      graphPresetRepo.save.mockImplementation(async (p) => p as never);

      await expect(
        service.update('gp-1', { isGlobal: false }, mockUserId, false, [mockOrgId]),
      ).resolves.toBeDefined();
    });

    // The one test that looked like it covered this asserted nothing about the fields
    // that were NOT supplied, and never checked updatedBy.
    it('changes only what was sent, and stamps updatedBy', async () => {
      graphPresetRepo.findOne.mockResolvedValue(
        createMockPreset({ id: 'gp-1', userId: mockUserId, name: 'Old', description: 'keep', isGlobal: false, testRunId: 'run-1' }),
      );
      graphPresetRepo.save.mockImplementation(async (p) => p as never);

      const result = await service.update('gp-1', { name: 'New', isGlobal: true }, mockUserId, false, [mockOrgId]);

      expect(result.name).toBe('New');
      expect(result.description).toBe('keep');
      expect(result.isGlobal).toBe(true);
      expect(graphPresetRepo.save.mock.calls[0]![0]).toMatchObject({ updatedBy: mockUserId });
    });

    it('404s on a preset that does not exist', async () => {
      graphPresetRepo.findOne.mockResolvedValue(null);

      await expect(service.update('nope', { name: 'New' }, mockUserId, false, [mockOrgId]))
        .rejects.toThrow('not found');
    });
  });

  describe('audit logging (Phase 5a, PR12)', () => {
    it('logs CREATE with organizationIdOverride from the persisted preset', async () => {
      const created = createMockPreset({ id: 'gp-create' });
      graphPresetRepo.create.mockReturnValue(created);
      graphPresetRepo.save.mockResolvedValue(created);

      await service.create(
        {
          name: 'My Graph',
          testRunId: 'run-1',
          seriesConfig: [{ panelId: 1 }],
        } as never,
        mockUserId,
        [mockOrgId],
      );

      expect(auditService.logCreate).toHaveBeenCalledTimes(1);
      expect(auditService.logCreate).toHaveBeenCalledWith(
        created,
        { organizationIdOverride: mockOrgId },
      );
    });

    // REGRESSION: without a run id the org/team lookup fell through to
    // `findOne({ where: { testRunId: undefined } })`, which TypeORM reads as "any test
    // run" — so a preset was stamped with an arbitrary system's organization. The save
    // dialog sent no run id for its default "Global" scope, so this was every global
    // preset. Refuse instead of guessing.
    it('refuses to create a preset with no test run to inherit the system from', async () => {
      await expect(
        service.create({ name: 'My Graph', seriesConfig: [{ panelId: 1 }] } as never, mockUserId, [mockOrgId]),
      ).rejects.toThrow('testRunId is required');

      expect(testRunRepo.findOne).not.toHaveBeenCalled();
      expect(graphPresetRepo.save).not.toHaveBeenCalled();
    });

    it('logs DELETE before repository.delete', async () => {
      const preset = createMockPreset({ id: 'gp-delete' });
      graphPresetRepo.findOne.mockResolvedValue(preset);
      graphPresetRepo.delete.mockResolvedValue({ affected: 1 } as never);

      await service.remove('gp-delete', mockUserId, true, [mockOrgId]);

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
