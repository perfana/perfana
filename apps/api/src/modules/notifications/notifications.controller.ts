import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CreateNotificationChannelDto, UpdateNotificationChannelDto } from './dto';
import { NotificationChannel } from '@perfana/shared';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';

@ApiTags('notifications')
@Controller('notifications')
@ApiBearerAuth()
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('channels')
  @ApiOperation({
    summary: 'Get all notification channels for a system',
    description: 'Returns all configured notification channels for a system under test',
  })
  @ApiQuery({
    name: 'systemId',
    description: 'System under test ID',
    required: true,
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Notification channels retrieved successfully',
  })
  async findBySystem(
    @Query('systemId', ParseUUIDPipe) systemId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<NotificationChannel[]> {
    return await this.notificationsService.findBySystemId(systemId, ctx.userId, ctx.roles);
  }

  @Get('channels/:id')
  @ApiOperation({
    summary: 'Get a specific notification channel',
    description: 'Returns a single notification channel by ID',
  })
  @ApiParam({
    name: 'id',
    description: 'Notification channel ID',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Notification channel retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Notification channel not found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @UserCtx() ctx: UserContext,
  ): Promise<NotificationChannel> {
    return await this.notificationsService.findOne(id, ctx.userId, ctx.roles);
  }

  @Post('channels')
  @ApiOperation({
    summary: 'Create a new notification channel',
    description: 'Creates a new Slack or Teams notification channel for a system',
  })
  @ApiResponse({
    status: 201,
    description: 'Notification channel created successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async create(
    @Body() createDto: CreateNotificationChannelDto,
    @UserCtx() ctx: UserContext,
  ): Promise<NotificationChannel> {
    return await this.notificationsService.create(createDto, ctx.userId, ctx.roles);
  }

  @Put('channels/:id')
  @ApiOperation({
    summary: 'Update a notification channel',
    description: 'Updates an existing notification channel',
  })
  @ApiParam({
    name: 'id',
    description: 'Notification channel ID',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Notification channel updated successfully',
  })
  @ApiResponse({ status: 404, description: 'Notification channel not found' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateNotificationChannelDto,
    @UserCtx() ctx: UserContext,
  ): Promise<NotificationChannel> {
    return await this.notificationsService.update(id, updateDto, ctx.userId, ctx.roles);
  }

  @Delete('channels/:id')
  @ApiOperation({
    summary: 'Delete a notification channel',
    description: 'Deletes a notification channel by ID',
  })
  @ApiParam({
    name: 'id',
    description: 'Notification channel ID',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Notification channel deleted successfully',
  })
  @ApiResponse({ status: 404, description: 'Notification channel not found' })
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserCtx() ctx: UserContext,
  ): Promise<{ message: string }> {
    await this.notificationsService.delete(id, ctx.userId, ctx.roles);
    return { message: 'Notification channel deleted successfully' };
  }

  @Post('channels/:id/test')
  @ApiOperation({
    summary: 'Send a test notification',
    description: 'Sends a test notification to verify the channel configuration',
  })
  @ApiParam({
    name: 'id',
    description: 'Notification channel ID',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Test notification result',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Notification channel not found' })
  async testChannel(
    @Param('id', ParseUUIDPipe) id: string,
    @UserCtx() ctx: UserContext,
  ): Promise<{ success: boolean; message: string }> {
    return await this.notificationsService.testChannel(id, ctx.userId, ctx.roles);
  }
}
