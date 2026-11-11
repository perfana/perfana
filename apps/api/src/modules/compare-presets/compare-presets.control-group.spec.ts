import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CONTROL_GROUP_BASELINE } from '@perfana/shared/types';
import { ComparePresetsService, baselineRunOf } from './compare-presets.service';
import { CompareFilterPreset, TestRun as TestRunEntity } from '../../entities';
import { CreateComparePresetDto, PresetType } from './dto/create-compare-preset.dto';
import { createMockRepository, MockRepository } from '../../../test/helpers/mock-repository.factory';
import { AuthorizationService } from '../../common/services/authorization.service';
import { AuditService } from '../audit/audit.service';

/**
 * A compare preset can store the Compare card's "Control group" baseline. Its
 * `baseline_test_run_id` then holds `CONTROL_GROUP_BASELINE`, which names no run, so every
 * code path that treats the column as a run id has to step around it.
 */
describe('ComparePresetsService — control-group baseline', () => {
  const userId = 'user-uuid';
  let service: ComparePresetsService;
  let comparePresetRepo: MockRepository<CompareFilterPreset>;
  let testRunRepo: MockRepository<TestRunEntity>;

  const stored = {
    id: 'preset-uuid',
    name: 'CPU vs control group',
    presetType: 'generic',
    showPercentiles: false,
    baselineTestRunId: CONTROL_GROUP_BASELINE,
    createdForTestRunId: 'run-7',
    isGlobal: true,
    createdBy: 'someone-else',
    createdAt: new Date('2026-11-07T10:00:00Z'),
    updatedAt: new Date('2026-11-07T10:00:00Z'),
  } as CompareFilterPreset;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComparePresetsService,
        { provide: getRepositoryToken(CompareFilterPreset), useValue: createMockRepository<CompareFilterPreset>() },
        { provide: getRepositoryToken(TestRunEntity), useValue: createMockRepository<TestRunEntity>() },
        {
          provide: AuthorizationService,
          useValue: {
            isGlobalAdmin: jest.fn().mockReturnValue(false),
            getAccessibleOrganizations: jest.fn().mockResolvedValue(['org-1']),
          },
        },
        { provide: AuditService, useValue: { logCreate: jest.fn(), logUpdate: jest.fn(), logDelete: jest.fn() } },
      ],
    }).compile();

    service = module.get(ComparePresetsService);
    comparePresetRepo = module.get(getRepositoryToken(CompareFilterPreset));
    testRunRepo = module.get(getRepositoryToken(TestRunEntity));
    testRunRepo.findOne.mockResolvedValue({
      testRunId: 'run-7',
      systemUnderTest: { organization_id: 'org-1', team_id: undefined },
    } as never);
  });

  it('names no run for the sentinel, and any other value for itself', () => {
    expect(baselineRunOf(CONTROL_GROUP_BASELINE)).toBeUndefined();
    expect(baselineRunOf(undefined)).toBeUndefined();
    expect(baselineRunOf('')).toBeUndefined();
    expect(baselineRunOf('run-3')).toBe('run-3');
  });

  it('saves a non-admin\'s preset without access-checking the sentinel as a run', async () => {
    testRunRepo.query.mockResolvedValue([{ '?column?': 1 }]);
    comparePresetRepo.create.mockImplementation((v) => ({ ...stored, ...v }) as CompareFilterPreset);
    comparePresetRepo.save.mockImplementation(async (v) => v as CompareFilterPreset);
    const dto: CreateComparePresetDto = {
      name: 'CPU vs control group',
      preset_type: PresetType.GENERIC,
      show_percentiles: false,
      is_global: false,
      baseline_test_run_id: CONTROL_GROUP_BASELINE,
      created_for_test_run_id: 'run-7',
    };

    const result = await service.create(dto, userId, ['user']);

    // One access check, for the run the preset was made on — never for the sentinel.
    expect(testRunRepo.query).toHaveBeenCalledTimes(1);
    expect(testRunRepo.query.mock.calls[0]![1]).toEqual(['run-7', ['org-1']]);
    // The organization is inherited from that run, not looked up by the sentinel.
    expect(testRunRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { testRunId: 'run-7' } }));
    expect(testRunRepo.findOne).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { testRunId: CONTROL_GROUP_BASELINE } }),
    );
    expect(result.baseline_test_run_id).toBe(CONTROL_GROUP_BASELINE);
  });

  // Value: protects=a preset naming only the sentinel inherits the caller's org instead of looking the sentinel up as a run; fails_when=the parent lookup reads baseline_test_run_id raw (ResourceNotFound TestRun control-group); why_new=the case above names a created-for run, which short-circuits before baselineRunOf; seam=none; no_claim=the audit row.
  it('inherits the caller\'s organization, not a lookup of the sentinel, when no created-for run is named', async () => {
    comparePresetRepo.create.mockImplementation((v) => ({ ...stored, ...v }) as CompareFilterPreset);
    comparePresetRepo.save.mockImplementation(async (v) => v as CompareFilterPreset);

    const result = await service.create({
      name: 'CPU vs control group',
      preset_type: PresetType.GENERIC,
      show_percentiles: false,
      is_global: false,
      baseline_test_run_id: CONTROL_GROUP_BASELINE,
    }, userId, ['user']);

    // beforeEach makes findOne answer for any id, so only "never called" catches a sentinel lookup.
    expect(testRunRepo.findOne).not.toHaveBeenCalled();
    expect(comparePresetRepo.create).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-1' }));
    expect(result.baseline_test_run_id).toBe(CONTROL_GROUP_BASELINE);
  });

  it('lets another user see a shared control-group preset and does not enrich it as a run', async () => {
    testRunRepo.query.mockResolvedValue([{ '?column?': 1 }]);
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(stored),
    };
    comparePresetRepo.createQueryBuilder.mockReturnValue(qb as never);

    const result = await service.findOne('preset-uuid', userId, ['user']);

    expect(testRunRepo.query).toHaveBeenCalledTimes(1);
    expect(testRunRepo.query.mock.calls[0]![1]).toEqual(['run-7', ['org-1']]);
    expect(testRunRepo.findOne).not.toHaveBeenCalled();
    expect(result.baseline_test_run_id).toBe(CONTROL_GROUP_BASELINE);
  });

  /**
   * Value: protects=a non-admin's preset list keeps another user's global control-group preset, unenriched;
   * fails_when=findAll access-checks or enriches the sentinel as a run (the preset vanishes from the list);
   * why_new=create/findOne are pinned, findAll's filter and enrichment are separate call sites; seam=none;
   * no_claim=SUT scoping of the list query, which the mocked query builder does not execute.
   */
  it('keeps another user\'s global control-group preset in a non-admin\'s list', async () => {
    // Only the run the preset was made on is accessible; the sentinel names no run, so a
    // lookup of it answers nothing — which is what would hide the preset without the guard.
    testRunRepo.query.mockImplementation(async (_sql: string, params?: unknown[]) =>
      (params?.[0] === 'run-7' ? [{ '?column?': 1 }] : []));
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([stored]),
    };
    comparePresetRepo.createQueryBuilder.mockReturnValue(qb as never);

    const result = await service.findAll(userId, 'run-7', ['user']);

    expect(result.map((p) => p.baseline_test_run_id)).toEqual([CONTROL_GROUP_BASELINE]);
    expect(testRunRepo.query.mock.calls.map((c) => (c[1] as unknown[])[0])).toEqual(['run-7']);
    expect(testRunRepo.findOne).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { testRunId: CONTROL_GROUP_BASELINE } }),
    );
  });

  /**
   * Value: protects=a non-admin can switch their own preset's baseline to the control group;
   * fails_when=update access-checks the sentinel as a run and answers 404 TestRun control-group;
   * why_new=update has its own baselineRunOf call site, unexercised by the create/findOne cases; seam=none;
   * no_claim=the audit diff and the column mapping of the other update fields.
   */
  it('lets a non-admin point their own preset at the control group', async () => {
    testRunRepo.query.mockImplementation(async (_sql: string, params?: unknown[]) =>
      (params?.[0] === 'run-7' ? [{ '?column?': 1 }] : []));
    const own = { ...stored, createdBy: userId, baselineTestRunId: 'run-3' } as CompareFilterPreset;
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(own),
    };
    comparePresetRepo.createQueryBuilder.mockReturnValue(qb as never);
    const updatedRow = { ...own, baselineTestRunId: CONTROL_GROUP_BASELINE } as CompareFilterPreset;
    comparePresetRepo.findOne.mockResolvedValueOnce(own).mockResolvedValueOnce(updatedRow);
    comparePresetRepo.update.mockResolvedValue({ affected: 1 } as never);
    testRunRepo.findOne.mockClear();

    const result = await service.update('preset-uuid', { baseline_test_run_id: CONTROL_GROUP_BASELINE }, userId, ['user']);

    expect(comparePresetRepo.update).toHaveBeenCalledWith(
      { id: 'preset-uuid', createdBy: userId },
      expect.objectContaining({ baselineTestRunId: CONTROL_GROUP_BASELINE }),
    );
    expect(testRunRepo.query.mock.calls.some((c) => (c[1] as unknown[])[0] === CONTROL_GROUP_BASELINE)).toBe(false);
    expect(testRunRepo.findOne).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { testRunId: CONTROL_GROUP_BASELINE } }),
    );
    expect(result.baseline_test_run_id).toBe(CONTROL_GROUP_BASELINE);
  });
});
