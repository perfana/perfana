import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { BrowserPoolService } from '../pdf/browser-pool.service';

@Injectable()
export class BrowserPoolHealthIndicator extends HealthIndicator {
  constructor(private readonly browserPoolService: BrowserPoolService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const isReady = this.browserPoolService.isReady();

      if (!isReady) {
        throw new Error('Browser pool is not ready');
      }

      const stats = this.browserPoolService.getPoolStats();

      // Check if at least one browser is connected
      if (stats.connected === 0) {
        throw new Error('No browsers connected in pool');
      }

      return this.getStatus(key, true, stats);
    } catch (error) {
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';

      throw new HealthCheckError(
        'Browser pool health check failed',
        this.getStatus(key, false, { message: errorMessage })
      );
    }
  }
}
