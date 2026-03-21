import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GrafanaApiService } from './grafana-api.service';
import { GrafanaDbService } from './grafana-db.service';
import { GrafanaInstance } from '@perfana/shared/entities';

/**
 * GrafanaApiModule
 *
 * Provides Grafana API and database access services.
 * Wraps the existing GrafanaClient from worker for HTTP API access.
 */
@Module({
  imports: [TypeOrmModule.forFeature([GrafanaInstance])],
  providers: [GrafanaApiService, GrafanaDbService],
  exports: [GrafanaApiService, GrafanaDbService],
})
export class GrafanaApiModule {}
