import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';

/**
 * GeneralSanityCheckerService
 *
 * Performs general system health checks.
 * Runs hourly when enabled.
 */
@Injectable()
export class GeneralSanityCheckerService {
  private readonly logger = new Logger(GeneralSanityCheckerService.name);

  constructor(private configService: ConfigService) {}

  /**
   * Run general sanity checks every hour
   */
  @Cron(CronExpression.EVERY_HOUR)
  async runGeneralChecks() {
    if (!this.configService.get<boolean>('grafanaSync.sanityChecker.general.enabled', false)) {
      return;
    }

    this.logger.debug('General sanity checks not yet implemented');
  }
}
