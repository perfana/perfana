import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  HealthCheckService,
  HealthCheck,
  TypeOrmHealthIndicator,
  MemoryHealthIndicator,
  DiskHealthIndicator,
  HealthCheckResult,
} from '@nestjs/terminus';
import { Public } from '../../decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly heapThreshold: number;
  private readonly rssThreshold: number;

  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
    private readonly configService: ConfigService,
  ) {
    this.heapThreshold = this.configService.get<number>('HEALTH_HEAP_THRESHOLD_MB', 1500) * 1024 * 1024;
    this.rssThreshold = this.configService.get<number>('HEALTH_RSS_THRESHOLD_MB', 3000) * 1024 * 1024;
  }

  @Get()
  @Public()
  @HealthCheck()
  @ApiOperation({ summary: 'Check overall application health' })
  @ApiResponse({
    status: 200,
    description: 'Health check successful',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        info: { type: 'object' },
        error: { type: 'object' },
        details: { type: 'object' },
      },
    },
  })
  @ApiResponse({ status: 503, description: 'Health check failed' })
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.memory.checkHeap('memory_heap', this.heapThreshold),
      () => this.memory.checkRSS('memory_rss', this.rssThreshold),
    ]);
  }

  @Get('db')
  @Public()
  @HealthCheck()
  @ApiOperation({ summary: 'Check database connectivity' })
  @ApiResponse({
    status: 200,
    description: 'Database is healthy',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        info: {
          type: 'object',
          properties: {
            database: {
              type: 'object',
              properties: {
                status: { type: 'string', example: 'up' },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 503, description: 'Database is unhealthy' })
  checkDatabase(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.db.pingCheck('database'),
    ]);
  }

  @Get('memory')
  @Public()
  @HealthCheck()
  @ApiOperation({ summary: 'Check memory usage' })
  @ApiResponse({
    status: 200,
    description: 'Memory usage is within limits',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        info: {
          type: 'object',
          properties: {
            memory_heap: {
              type: 'object',
              properties: {
                status: { type: 'string', example: 'up' },
              },
            },
            memory_rss: {
              type: 'object',
              properties: {
                status: { type: 'string', example: 'up' },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 503, description: 'Memory usage exceeds limits' })
  checkMemory(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.memory.checkHeap('memory_heap', this.heapThreshold),
      () => this.memory.checkRSS('memory_rss', this.rssThreshold),
    ]);
  }

  @Get('disk')
  @Public()
  @HealthCheck()
  @ApiOperation({ summary: 'Check disk usage' })
  @ApiResponse({
    status: 200,
    description: 'Disk usage is within limits',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        info: {
          type: 'object',
          properties: {
            storage: {
              type: 'object',
              properties: {
                status: { type: 'string', example: 'up' },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 503, description: 'Disk usage exceeds limits' })
  checkDisk(): Promise<HealthCheckResult> {
    return this.health.check([
      // Disk should have at least 10% (0.1) free space
      () => this.disk.checkStorage('storage', {
        path: '/',
        thresholdPercent: 0.9, // Alert when 90% full
      }),
    ]);
  }
}
