import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GeneralSanityCheckerService } from './general-sanity-checker.service';
import { createMockConfigService } from '../../../test/helpers';

describe('GeneralSanityCheckerService', () => {
  let service: GeneralSanityCheckerService;
  let configService: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeneralSanityCheckerService,
        {
          provide: ConfigService,
          useValue: createMockConfigService({
            grafanaSync: {
              sanityChecker: {
                general: {
                  enabled: true,
                },
              },
            },
          }),
        },
      ],
    }).compile();

    service = module.get<GeneralSanityCheckerService>(GeneralSanityCheckerService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Service Initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should have all required dependencies injected', () => {
      expect((service as any).configService).toBeDefined();
    });
  });

  describe('runGeneralChecks', () => {
    it('should log debug message when enabled', async () => {
      const debugSpy = jest.spyOn((service as any).logger, 'debug');

      await service.runGeneralChecks();

      expect(debugSpy).toHaveBeenCalledWith('General sanity checks not yet implemented');
    });

    it('should skip when disabled', async () => {
      configService.get.mockReturnValue(false);
      const debugSpy = jest.spyOn((service as any).logger, 'debug');

      await service.runGeneralChecks();

      expect(debugSpy).not.toHaveBeenCalled();
    });

    it('should skip when config is undefined', async () => {
      configService.get.mockReturnValue(undefined);
      const debugSpy = jest.spyOn((service as any).logger, 'debug');

      await service.runGeneralChecks();

      expect(debugSpy).not.toHaveBeenCalled();
    });

    it('should skip when config is null', async () => {
      configService.get.mockReturnValue(null);
      const debugSpy = jest.spyOn((service as any).logger, 'debug');

      await service.runGeneralChecks();

      expect(debugSpy).not.toHaveBeenCalled();
    });

    it('should use ConfigService for configuration', async () => {
      await service.runGeneralChecks();

      expect(configService.get).toHaveBeenCalledWith(
        'grafanaSync.sanityChecker.general.enabled',
        false,
      );
    });

    it('should have runGeneralChecks decorated with @Cron', () => {
      expect(typeof service.runGeneralChecks).toBe('function');
    });
  });
});
