import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeysService } from '../modules/api-keys/api-keys.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeysService: ApiKeysService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if the route is marked as public (skip authentication)
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('Missing Authorization header');
    }

    const [type, token] = authHeader.split(' ');

    if (type !== 'Bearer') {
      throw new UnauthorizedException('Invalid authorization type. Expected Bearer token');
    }

    if (!token) {
      throw new UnauthorizedException('Missing Bearer token');
    }

    try {
      const apiKey = await this.apiKeysService.validateApiKey(token);

      if (!apiKey) {
        throw new UnauthorizedException('Invalid or expired API key');
      }

      // Attach API key info to the request for role checking
      request.apiKey = {
        id: apiKey.id,
        description: apiKey.description,
        roles: apiKey.roles,
        validUntil: apiKey.validUntil,
      };
      request.authType = 'api-key';

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Authentication failed');
    }
  }
}