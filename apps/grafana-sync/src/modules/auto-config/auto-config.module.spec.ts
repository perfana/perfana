import { MODULE_METADATA } from '@nestjs/common/constants';
import { AutoConfigModule } from './auto-config.module';
import { AutoConfigService } from './auto-config.service';
import { GroupingRuleProcessorService } from './grouping-rule-processor.service';

/**
 * AutoConfigService injects GroupingRuleProcessorService. A provider missing from the module is
 * not caught by any service spec (they build their own TestingModule); it fails only when
 * grafana-sync boots, which takes the whole auto-config cron down.
 */
describe('AutoConfigModule', () => {
  it('provides every service AutoConfigService injects', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AutoConfigModule) as unknown[];
    expect(providers).toEqual(
      expect.arrayContaining([AutoConfigService, GroupingRuleProcessorService]),
    );
  });
});
