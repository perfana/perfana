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
});
