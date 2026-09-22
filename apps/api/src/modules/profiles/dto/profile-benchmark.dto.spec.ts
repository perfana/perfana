import { validate } from 'class-validator';
import { plainToClass } from 'class-transformer';
import { CreateProfileBenchmarkDto } from './profile-benchmark.dto';

/**
 * `profileDashboardId` became optional so a `performance-metrics` benchmark can be posted
 * without one. The DTO must still reject a malformed id, and leave "required for a Grafana
 * source" to the service (it has to know the source to decide).
 */
describe('CreateProfileBenchmarkDto', () => {
  it('accepts a performance-metrics benchmark with no profileDashboardId', async () => {
    const dto = plainToClass(CreateProfileBenchmarkDto, {
      source: 'performance-metrics',
      panelId: 105,
      panelTitle: 'Transaction Error Rate',
      requirementOperator: 'lt',
      requirementValue: 2,
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts a grafana benchmark with a UUID profileDashboardId', async () => {
    const dto = plainToClass(CreateProfileBenchmarkDto, {
      profileDashboardId: '550e8400-e29b-41d4-a716-446655440000',
      source: 'grafana',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('still rejects a profileDashboardId that is not a UUID', async () => {
    const dto = plainToClass(CreateProfileBenchmarkDto, {
      profileDashboardId: 'not-a-uuid',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('profileDashboardId');
  });

  it('does not require profileDashboardId at the DTO layer for a grafana source (the service does)', async () => {
    const dto = plainToClass(CreateProfileBenchmarkDto, { source: 'grafana' });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
