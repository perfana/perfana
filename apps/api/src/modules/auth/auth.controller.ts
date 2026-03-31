import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Public } from '../../decorators/public.decorator';
import { CurrentUser } from '../../decorators/current-user.decorator';
import { SkipThrottle } from '../../decorators/throttle-config.decorator';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { KeycloakUser } from './keycloak-jwt.service';
import { AxiosResponse } from 'axios';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly httpService: HttpService,
  ) {}

  @Get('health')
  @Public()
  @SkipThrottle() // Health checks should not be rate limited
  @ApiOperation({ summary: 'Health check for auth module' })
  @ApiResponse({ status: 200, description: 'Health check passed' })
  getHealth(): { status: string; module: string } {
    return { status: 'ok', module: 'auth' };
  }

  @Get('jwks')
  @Public()
  @ApiOperation({ summary: 'Get Keycloak JWKS (proxy to avoid CORS)' })
  @ApiResponse({ status: 200, description: 'JWKS retrieved successfully' })
  @ApiResponse({ status: 500, description: 'Failed to fetch JWKS' })
  async getJWKS() {
    try {
      const keycloakUrl = process.env.KEYCLOAK_URL || 'http://localhost:8080';
      const realm = process.env.KEYCLOAK_REALM || 'perfana-prod';
      const jwksUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/certs`;

      const response: AxiosResponse = await firstValueFrom(
        this.httpService.get(jwksUrl)
      );

      return response.data;
    } catch (error) {
      this.logger.error(
        'Failed to fetch JWKS from Keycloak',
        error instanceof Error ? error.stack : undefined,
        {
          keycloakUrl: process.env.KEYCLOAK_URL,
          realm: process.env.KEYCLOAK_REALM,
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      );
      throw new ServiceUnavailableException('Failed to fetch JWKS from Keycloak');
    }
  }

  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile from Keycloak token' })
  @ApiResponse({ status: 200, description: 'Profile retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getProfile(@CurrentUser() user: KeycloakUser) {
    return {
      user: {
        id: user.sub,
        email: user.email,
        name: user.given_name && user.family_name ? `${user.given_name} ${user.family_name}` : user.preferred_username,
        preferred_username: user.preferred_username,
        roles: user.roles,
      },
    };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user info (alias for profile)' })
  @ApiResponse({ status: 200, description: 'User info retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMe(@CurrentUser() user: KeycloakUser) {
    return this.getProfile(user);
  }
}
