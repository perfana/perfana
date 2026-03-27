import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GrafanaApiService } from './grafana-api.service';
import { GrafanaInstance } from '@perfana/shared/entities';

/**
 * GrafanaApiModule
 *
 * Provides Grafana API access services.
 * Wraps the existing GrafanaClient from worker for HTTP API access.
 */
@Module({
  imports: [TypeOrmModule.forFeature([GrafanaInstance])],
  providers: [GrafanaApiService],
  exports: [GrafanaApiService],
})
export class GrafanaApiModule {}
