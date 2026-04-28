import { Controller, Get, Post, Delete, Body, Param, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto, ApiKeyDto, CreateApiKeyResponseDto } from './dto/create-api-key.dto';
import { AdminOnly } from '../../decorators/admin-only.decorator';
import { ThrottleConfig } from '../../decorators/throttle-config.decorator';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';
import { AuthorizationService } from '../../common/services/authorization.service';

@ApiTags('api-keys')
@Controller('api-keys')
@ApiBearerAuth()
export class ApiKeysController {
  constructor(
    private readonly apiKeysService: ApiKeysService,
    private readonly authzService: AuthorizationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get all API keys' })
  @ApiResponse({ status: 200, description: 'API keys retrieved successfully', type: [ApiKeyDto] })
  async findAll(@UserCtx() ctx: UserContext, @Query('organizationId') organizationId?: string) {
    return this.apiKeysService.findAll(ctx.userId, ctx.roles, organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single API key' })
  @ApiResponse({ status: 200, description: 'API key retrieved successfully', type: ApiKeyDto })
  @ApiResponse({ status: 404, description: 'API key not found' })
  async findOne(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    return this.apiKeysService.findOne(id, ctx.userId, ctx.roles);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new API key' })
  @ApiResponse({ status: 201, description: 'API key created successfully', type: CreateApiKeyResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 403, description: 'Organization admin privileges required' })
  @ApiResponse({ status: 409, description: 'An API key with this description already exists in the organization' })
  async create(@Body() createDto: CreateApiKeyDto, @UserCtx() ctx: UserContext) {
    // Resolve target organization. Body wins; otherwise fall back to user-context
    // org; otherwise fall back to the user's first accessible org. The service
    // performs the actual capability check (`Capability.ApiKeyCreate` for the
    // resolved org), so we don't pre-gate here — we only need to ensure
    // the caller has *somewhere* to create the key.
    let organizationId = createDto.organizationId || ctx.organizationId;

    if (!organizationId) {
      const userOrgs = await this.authzService.getAccessibleOrganizations(ctx.userId);
      if (userOrgs.length === 0) {
        throw new BadRequestException(
          'User must belong to an organization to create API keys',
        );
      }
      organizationId = userOrgs[0];
    }

    const result = await this.apiKeysService.createApiKey(createDto, ctx.userId, ctx.roles, organizationId!);

    return {
      apiKey: {
        id: result.apiKey.id,
        description: result.apiKey.description,
        roles: result.apiKey.roles,
        valid_until: result.apiKey.validUntil,
        created_at: result.apiKey.createdAt,
        last_used: result.apiKey.lastUsed,
      },
      token: result.token, // Only returned once during creation
    };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an API key' })
  @ApiResponse({ status: 200, description: 'API key deleted successfully' })
  @ApiResponse({ status: 403, description: 'Organization admin privileges required' })
  @ApiResponse({ status: 404, description: 'API key not found' })
  async delete(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    await this.apiKeysService.deleteApiKey(id, ctx.userId, ctx.roles);

    return {
      message: 'API key deleted successfully',
    };
  }

  @Post('validate')
  @ThrottleConfig(5, 60000) // Strict rate limit for validation endpoint (prevents brute force)
  @ApiOperation({ summary: 'Validate an API key' })
  @ApiResponse({ status: 200, description: 'API key validation result' })
  async validate(@Body('token') token: string) {
    const apiKey = await this.apiKeysService.validateApiKey(token);

    // Only return validity status — no key metadata (prevents info disclosure)
    return {
      valid: !!apiKey,
    };
  }

  @Get('cache/stats')
  @AdminOnly()
  @ApiOperation({ summary: 'Get API key cache statistics' })
  @ApiResponse({ status: 200, description: 'Cache statistics retrieved successfully' })
  @ApiResponse({ status: 403, description: 'Global admin privileges required' })
  async getCacheStats() {
    return this.apiKeysService.getCacheStats();
  }

  @Post('cache/clear')
  @AdminOnly()
  @ApiOperation({ summary: 'Clear all API key caches' })
  @ApiResponse({ status: 200, description: 'Caches cleared successfully' })
  @ApiResponse({ status: 403, description: 'Global admin privileges required' })
  async clearCaches() {
    await this.apiKeysService.clearCaches();
    return {
      message: 'All API key caches cleared successfully',
    };
  }

  @Post('cache/warm')
  @AdminOnly()
  @ApiOperation({ summary: 'Warm API key caches with frequently used keys' })
  @ApiResponse({ status: 200, description: 'Caches warmed successfully' })
  @ApiResponse({ status: 403, description: 'Global admin privileges required' })
  async warmCaches() {
    await this.apiKeysService.warmCaches();
    return {
      message: 'API key caches warmed successfully',
    };
  }
}
