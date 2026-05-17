import { NotFoundException } from '@nestjs/common';
import { AdaptController } from './adapt.controller';
import { AdaptService } from './adapt.service';
import { ValidationException } from '../../common/exceptions/business.exception';

function makeController(overrides: Partial<AdaptService> = {}) {
  const service = {
    getDsAdaptConclusion: jest.fn(),
    getEnrichedConclusion: jest.fn(),
    getTrackedRegressions: jest.fn(),
    getTrackedRegressionsCount: jest.fn(),
    resolveTrackedRegressions: jest.fn(),
    ...overrides,
  } as unknown as AdaptService;

  const controller = new AdaptController(service);
  return { controller, service };
}

const ctx = { userId: 'user-1', roles: ['user'] };

describe('AdaptController', () => {
  describe('getDsAdaptConclusion()', () => {
    it('throws ValidationException when testRunId is empty string', async () => {
      const { controller } = makeController();
      await expect(
        controller.getDsAdaptConclusion('', ctx as any),
      ).rejects.toBeInstanceOf(ValidationException);
    });

    it('throws NotFoundException when service returns null', async () => {
      const { controller, service } = makeController();
      (service.getDsAdaptConclusion as jest.Mock).mockResolvedValue(null);
      await expect(
        controller.getDsAdaptConclusion('run-1', ctx as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the service result when it is non-null', async () => {
      const payload = { verdict: 'pass' };
      const { controller, service } = makeController();
      (service.getDsAdaptConclusion as jest.Mock).mockResolvedValue(payload);
      const result = await controller.getDsAdaptConclusion('run-1', ctx as any);
      expect(result).toBe(payload);
    });
  });

  describe('getEnrichedConclusion()', () => {
    it('throws ValidationException when testRunId is empty string', async () => {
      const { controller } = makeController();
      await expect(
        controller.getEnrichedConclusion('', ctx as any),
      ).rejects.toBeInstanceOf(ValidationException);
    });

    it('throws NotFoundException when service returns null', async () => {
      const { controller, service } = makeController();
      (service.getEnrichedConclusion as jest.Mock).mockResolvedValue(null);
      await expect(
        controller.getEnrichedConclusion('run-1', ctx as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the service result when it is non-null', async () => {
      const payload = { enriched: true, regressions: [] };
      const { controller, service } = makeController();
      (service.getEnrichedConclusion as jest.Mock).mockResolvedValue(payload);
      const result = await controller.getEnrichedConclusion('run-1', ctx as any);
      expect(result).toBe(payload);
    });
  });
});
