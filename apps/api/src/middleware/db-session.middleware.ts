import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, QueryRunner } from 'typeorm';
import { AuthenticatedRequest, SessionContext } from '../types';
import { Response, NextFunction } from 'express';

@Injectable()
export class DatabaseSessionMiddleware implements NestMiddleware {
  private readonly logger = new Logger(DatabaseSessionMiddleware.name);

  /**
   * Whether to downgrade to perfana_app role (non-superuser, RLS-enforced)
   * within the per-request transaction. Controlled by DB_ENABLE_RLS_ROLE env var.
   */
  private readonly enableRlsRole: boolean;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {
    this.enableRlsRole = this.configService.get<string>('DB_ENABLE_RLS_ROLE', 'false') === 'true';
    if (this.enableRlsRole) {
      this.logger.log('RLS role enforcement enabled: queryRunner will use perfana_app role');
    }
  }

  async use(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    // Only set session context for authenticated users
    if (!req.authType || !req.user) {
      return next();
    }

    const sessionContext = await this.extractSessionContext(req);

    if (!sessionContext.userId) {
      this.logger.debug('No user ID found, skipping session context setup');
      return next();
    }

    // Always attach session context to request (organizations, roles, etc.)
    // This must happen even if the DB transaction setup fails below,
    // so that controllers can still access user organizations via ctx.
    req.sessionContext = sessionContext;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      // Start a transaction so SET LOCAL persists for the request lifecycle.
      // Without a transaction, SET LOCAL has no lasting effect in PostgreSQL.
      await queryRunner.startTransaction();

      // Set PostgreSQL session variables for Row Level Security
      await this.setSessionVariables(queryRunner, sessionContext);

      // Optionally downgrade to restricted role (subject to RLS)
      // This must happen AFTER setting session vars, so RLS functions can read them.
      // SET LOCAL ROLE only applies within this transaction and reverts on commit/rollback.
      if (this.enableRlsRole) {
        try {
          await queryRunner.query('SET LOCAL ROLE perfana_app');
          this.logger.debug('Downgraded to perfana_app role for RLS enforcement');
        } catch (error) {
          this.logger.warn(`Failed to set restricted role (perfana_app may not exist): ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
        }
      }

      // Attach query runner to request for use in services
      req.queryRunner = queryRunner;

      this.logger.debug(`Session context set for user: ${sessionContext.userId} (${sessionContext.authType})`);

      // Clean up query runner when request finishes
      res.on('finish', async () => {
        try {
          await this.cleanupSession(queryRunner);
        } catch (error) {
          this.logger.error(`Failed to cleanup session: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
        }
      });

      res.on('close', async () => {
        try {
          await this.cleanupSession(queryRunner);
        } catch (error) {
          this.logger.error(`Failed to cleanup session on close: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
        }
      });

      next();
    } catch (error) {
      this.logger.error(`Failed to set session context: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
      await this.cleanupSession(queryRunner);
      next();
    }
  }

  private async extractSessionContext(req: AuthenticatedRequest): Promise<SessionContext> {
    const context: SessionContext = {
      authType: req.authType,
    };

    if (req.authType === 'keycloak-jwt' && req.user) {
      context.userId = req.user.sub;
      context.email = req.user.email;
      context.roles = req.user.roles;
      context.sessionId = req.user.sessionId;

      // Get organizations and teams from JWT if present, otherwise query database
      context.organizations = req.user.organizations || [];
      context.teams = req.user.teams || [];

      // If not in JWT, query database for organization memberships
      if ((!context.organizations || context.organizations.length === 0) && context.userId) {
        try {
          const orgMemberships = await this.dataSource.query(
            'SELECT organization_id FROM organization_members WHERE user_id = $1 ORDER BY created_at DESC',
            [context.userId]
          );
          context.organizations = orgMemberships.map((row: any) => row.organization_id);
          this.logger.debug(`Loaded ${context.organizations?.length || 0} organizations from database for user ${context.userId}`);

          // Check if user has selected a specific organization via header
          // SECURITY: Always validate against database membership - never trust client input
          const selectedOrgId = req.headers['x-organization-id'] as string;
          if (selectedOrgId && context.organizations && context.organizations.length > 0) {
            // Validate user is actually a member of the selected organization
            const isMember = context.organizations.includes(selectedOrgId);
            if (isMember) {
              // Move selected organization to front of array (becomes default)
              context.organizations = [
                selectedOrgId,
                ...context.organizations.filter(id => id !== selectedOrgId)
              ];
              this.logger.debug(`User selected organization ${selectedOrgId} - validated and set as current`);
            } else {
              // SECURITY: User tried to access an organization they're not a member of
              this.logger.warn(`User ${context.userId} attempted to select organization ${selectedOrgId} but is not a member - request rejected`);
              throw new Error('Access denied: You are not a member of the selected organization');
            }
          }
        } catch (error) {
          if (error && typeof error === 'object' && 'message' in error && (error as Error).message.includes('Access denied')) {
            throw error; // Re-throw security violations
          }
          this.logger.warn(`Failed to load organizations from database: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
        }
      }

      // If not in JWT, query database for team memberships
      if ((!context.teams || context.teams.length === 0) && context.userId) {
        try {
          const teamMemberships = await this.dataSource.query(
            'SELECT team_id FROM team_members WHERE user_id = $1',
            [context.userId]
          );
          context.teams = teamMemberships.map((row: any) => row.team_id);
          this.logger.debug(`Loaded ${context.teams?.length || 0} teams from database for user ${context.userId}`);
        } catch (error) {
          this.logger.warn(`Failed to load teams from database: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
        }
      }
    } else if (req.authType === 'api-key' && req.apiKey) {
      // Use actual API key roles instead of hardcoded admin
      context.userId = `api-key:${req.apiKey.id}`;
      context.roles = req.apiKey.roles; // Use the API key's actual roles
      context.organizations = [];
      context.teams = [];
      context.apiKeyId = req.apiKey.id;
    }

    return context;
  }

  private async setSessionVariables(queryRunner: QueryRunner, context: SessionContext): Promise<void> {
    const statements = [
      // Core user context
      `SET LOCAL app.current_user_id = '${this.sanitizeValue(context.userId || '')}'`,
      `SET LOCAL app.current_user_email = '${this.sanitizeValue(context.email || '')}'`,
      `SET LOCAL app.auth_type = '${this.sanitizeValue(context.authType || '')}'`,

      // Roles and permissions
      `SET LOCAL app.current_user_roles = '${this.sanitizeValue(JSON.stringify(context.roles || []))}'`,

      // Organizations and teams (for multi-tenant features)
      `SET LOCAL app.current_user_organizations = '${this.sanitizeValue(JSON.stringify(context.organizations || []))}'`,
      `SET LOCAL app.current_user_teams = '${this.sanitizeValue(JSON.stringify(context.teams || []))}'`,

      // Session metadata
      `SET LOCAL app.session_id = '${this.sanitizeValue(context.sessionId || '')}'`,
      `SET LOCAL app.session_timestamp = '${new Date().toISOString()}'`,
    ];

    for (const statement of statements) {
      try {
        await queryRunner.query(statement);
      } catch (error) {
        this.logger.warn(`Failed to execute session statement: ${statement} - ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
      }
    }

    // Log session context for debugging
    this.logger.debug(`Session variables set:`, {
      userId: context.userId,
      email: context.email,
      authType: context.authType,
      rolesCount: context.roles?.length || 0,
      organizationsCount: context.organizations?.length || 0,
      teamsCount: context.teams?.length || 0,
    });
  }

  private async cleanupSession(queryRunner: QueryRunner): Promise<void> {
    try {
      if (queryRunner.isTransactionActive) {
        await queryRunner.commitTransaction();
      }
    } catch (error) {
      this.logger.error(`Failed to commit transaction: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
      try {
        await queryRunner.rollbackTransaction();
      } catch (rollbackError) {
        this.logger.error(`Failed to rollback transaction: ${rollbackError && typeof rollbackError === 'object' && 'message' in rollbackError ? (rollbackError as Error).message : 'Unknown error'}`);
      }
    } finally {
      if (!queryRunner.isReleased) {
        await queryRunner.release();
      }
    }
  }

  private sanitizeValue(value: string): string {
    if (!value) return '';

    // Escape single quotes for PostgreSQL
    return value.replace(/'/g, "''");
  }

  /**
   * Helper method to get session context from request
   */
  static getSessionContext(req: AuthenticatedRequest): SessionContext | null {
    return req.sessionContext || null;
  }

  /**
   * Helper method to get query runner from request
   */
  static getQueryRunner(req: AuthenticatedRequest): QueryRunner | null {
    return req.queryRunner || null;
  }

  /**
   * Helper method to check if user has specific role
   */
  static hasRole(req: AuthenticatedRequest, role: string): boolean {
    const context = this.getSessionContext(req);
    return context?.roles?.includes(role) || false;
  }

  /**
   * Helper method to check if user has admin role
   */
  static isAdmin(req: AuthenticatedRequest): boolean {
    return this.hasRole(req, 'perfana-admin');
  }

  /**
   * Helper method to get user organizations
   */
  static getUserOrganizations(req: AuthenticatedRequest): string[] {
    const context = this.getSessionContext(req);
    return context?.organizations || [];
  }

  /**
   * Helper method to get user teams
   */
  static getUserTeams(req: AuthenticatedRequest): string[] {
    const context = this.getSessionContext(req);
    return context?.teams || [];
  }
}