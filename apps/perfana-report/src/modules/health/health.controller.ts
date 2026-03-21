import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { RedisHealthIndicator } from './redis.health';
import { BrowserPoolHealthIndicator } from './browser-pool.health';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
    private redis: RedisHealthIndicator,
    private browserPool: BrowserPoolHealthIndicator,
  ) {}

  /**
   * Liveness probe - checks if the application is running
   * Returns 200 if the process is alive
   */
  @Get('live')
  @HealthCheck()
  checkLive() {
    return this.health.check([]);
  }

  /**
   * Readiness probe - checks if the application is ready to serve traffic
   * Checks database, Redis, and browser pool connections
   */
  @Get('ready')
  @HealthCheck()
  checkReady() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.redis.isHealthy('redis'),
      () => this.browserPool.isHealthy('browser-pool'),
    ]);
  }
}
