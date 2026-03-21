import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * GrafanaDbService
 *
 * Provides direct MySQL/PostgreSQL access to Grafana's database.
 * Used for operations that bypass the HTTP API for performance or direct access.
 *
 * TODO: Port implementation from perfana-grafana's direct database queries
 */
@Injectable()
export class GrafanaDbService {
  private readonly logger = new Logger(GrafanaDbService.name);

  constructor(private configService: ConfigService) {}

  /**
   * Query dashboards directly from Grafana's database
   * Useful for bulk operations or when API is insufficient
   *
   * TODO: Implement direct database connection and queries
   * This may require separate database configuration for Grafana's MySQL/PostgreSQL
   */
  async queryDashboards(_instanceId: string): Promise<any[]> {
    this.logger.warn('queryDashboards() not yet implemented - needs direct DB connection setup');
    // TODO: Establish connection to Grafana database
    // TODO: Execute SQL queries against dashboard table
    return [];
  }

  /**
   * Get dashboard metadata directly from database
   * Bypasses HTTP API for faster bulk access
   *
   * TODO: Implement direct database queries
   */
  async getDashboardMetadata(_instanceId: string, _dashboardId: number): Promise<any> {
    this.logger.warn('getDashboardMetadata() not yet implemented');
    return null;
  }

  /**
   * Check if Grafana database connection is available
   *
   * TODO: Implement connection health check
   */
  async isAvailable(_instanceId: string): Promise<boolean> {
    this.logger.warn('isAvailable() not yet implemented');
    return false;
  }
}
