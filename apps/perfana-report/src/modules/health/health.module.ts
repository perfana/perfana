import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './redis.health';
import { BrowserPoolHealthIndicator } from './browser-pool.health';
import { PdfModule } from '../pdf/pdf.module';

@Module({
  imports: [TerminusModule, PdfModule],
  controllers: [HealthController],
  providers: [RedisHealthIndicator, BrowserPoolHealthIndicator],
})
export class HealthModule {}
