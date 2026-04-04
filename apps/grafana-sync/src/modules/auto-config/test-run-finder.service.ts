import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TestRun,
  Profile,
  ProfileBenchmark,
  Benchmark,
  ApplicationDashboard,
} from '@perfana/shared/entities';

@Injectable()
export class TestRunFinderService {
  private readonly logger = new Logger(TestRunFinderService.name);

  constructor(
    @InjectRepository(TestRun)
    private testRunRepo: Repository<TestRun>,
    @InjectRepository(Profile)
    private profileRepo: Repository<Profile>,
    @InjectRepository(ProfileBenchmark)
    private profileBenchmarkRepo: Repository<ProfileBenchmark>,
    @InjectRepository(Benchmark)
    private benchmarkRepo: Repository<Benchmark>,
  ) {}

  async findRecentTestRuns(startTime: Date, organizationIds?: string[]): Promise<TestRun[]> {
    try {
      let qb = this.testRunRepo
        .createQueryBuilder('tr')
        .innerJoinAndSelect('tr.systemUnderTest', 'sut')
        .where('tr.endTime >= :startTime', {
          startTime: startTime.toISOString(),
        });

      if (organizationIds && organizationIds.length > 0) {
        qb = qb.andWhere('(tr.organization_id IN (:...orgIds) OR tr.organization_id IS NULL)', {
          orgIds: organizationIds,
        });
      }

      const testRuns = await qb.getMany();

      testRuns.forEach((row) => {
        const systemUnderTestName = row.systemUnderTest?.name || row.systemUnderTestId;
        if (!systemUnderTestName) {
          this.logger.warn(`Test run ${row.testRunId} has null system_under_test name`);
        }
      });

      return testRuns;
    } catch (e) {
      this.logger.error('findRecentTestRuns failed:', e);
      return [];
    }
  }

  async findProfiles(organizationIds?: string[]): Promise<Profile[]> {
    try {
      if (organizationIds && organizationIds.length > 0) {
        return await this.profileRepo
          .createQueryBuilder('p')
          .where('(p.organization_id IN (:...orgIds) OR p.organization_id IS NULL)', {
            orgIds: organizationIds,
          })
          .getMany();
      }
      return (await this.profileRepo.find()) ?? [];
    } catch (e) {
      this.logger.error('findProfiles failed:', e);
      return [];
    }
  }

  async findProfileBenchmarks(organizationIds?: string[]): Promise<ProfileBenchmark[]> {
    try {
      let qb = this.profileBenchmarkRepo
        .createQueryBuilder('pb')
        .innerJoinAndSelect('pb.profile', 'profile');

      if (organizationIds && organizationIds.length > 0) {
        qb = qb.where(
          '(profile.organization_id IN (:...orgIds) OR profile.organization_id IS NULL)',
          { orgIds: organizationIds },
        );
      }

      return await qb.orderBy('pb.createdAt', 'DESC').getMany();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.stack : String(error);
      this.logger.error('Error finding profile benchmarks:', errorMessage);
      return [];
    }
  }

  async findBenchmarkForApplicationDashboardOrNull(
    applicationDashboard: ApplicationDashboard,
    profileBenchmarkId: string,
    workload: string,
  ): Promise<Benchmark | null> {
    try {
      const benchmark = await this.benchmarkRepo.findOne({
        where: {
          application_dashboard_id: applicationDashboard.id,
          generic_check_id: profileBenchmarkId,
          workload: workload,
        },
      });

      return benchmark || null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.stack : String(error);
      this.logger.error('Error finding benchmark for application dashboard:', errorMessage);
      return null;
    }
  }
}
