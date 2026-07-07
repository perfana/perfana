import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';
import { ProxyService } from './proxy.service';
import { UpsertProxyDto, ProxyResponseDto } from './dto/proxy.dto';

@ApiTags('proxy')
@ApiBearerAuth()
@Controller('proxy')
export class ProxyController {
  constructor(private readonly proxyService: ProxyService) {}

  @Get()
  @ApiOperation({ summary: 'Get the proxy configuration for the caller\'s organization' })
  @ApiResponse({
    status: 200,
    description: 'Proxy configuration, or null when none is configured (password is never returned)',
    type: ProxyResponseDto,
  })
  async getForOrg(@UserCtx() ctx: UserContext): Promise<ProxyResponseDto | null> {
    return this.proxyService.getForOrg(ctx.userId, ctx.roles);
  }

  @Put()
  @ApiOperation({ summary: 'Create or update the proxy configuration for the caller\'s organization' })
  @ApiResponse({
    status: 200,
    description: 'Proxy configuration upserted (password is never returned)',
    type: ProxyResponseDto,
  })
  async upsert(
    @Body() dto: UpsertProxyDto,
    @UserCtx() ctx: UserContext,
  ): Promise<ProxyResponseDto> {
    return this.proxyService.upsert(ctx.userId, ctx.roles, dto);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete the proxy configuration for the caller\'s organization' })
  @ApiResponse({ status: 204, description: 'Proxy configuration deleted' })
  async remove(@UserCtx() ctx: UserContext): Promise<void> {
    await this.proxyService.remove(ctx.userId, ctx.roles);
  }
}
