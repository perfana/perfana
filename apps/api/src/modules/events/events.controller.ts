import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { EventsService } from './events.service';
import { CreateEventDto, UpdateEventDto, EventQueryDto } from './dto/event.dto';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';

@ApiTags('events')
@Controller('events')
@ApiBearerAuth()
export class EventsController {
  private readonly logger = new Logger(EventsController.name);

  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all events' })
  @ApiResponse({ status: 200, description: 'Return all events' })
  async findAll(
    @Query() query: EventQueryDto,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      return await this.eventsService.findAll(ctx.userId, ctx.roles, query);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('Failed to fetch events:', error);
      throw new HttpException('Failed to fetch events', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('by-test-run/:testRunId')
  @ApiOperation({ summary: 'Get events for a specific test run' })
  @ApiParam({ name: 'testRunId', description: 'Test run UUID' })
  @ApiResponse({ status: 200, description: 'Return events for the test run' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async findByTestRun(
    @Param('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      return await this.eventsService.findByTestRun(testRunId, ctx.userId, ctx.roles);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Failed to fetch events for test run ${testRunId}:`, error);
      throw new HttpException('Failed to fetch events', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an event by ID' })
  @ApiParam({ name: 'id', description: 'Event UUID' })
  @ApiResponse({ status: 200, description: 'Return the event' })
  @ApiResponse({ status: 404, description: 'Event not found' })
  async findOne(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      return await this.eventsService.findOne(id, ctx.userId, ctx.roles);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Failed to fetch event ${id}:`, error);
      throw new HttpException('Failed to fetch event', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create a new event' })
  @ApiResponse({ status: 201, description: 'The event has been created' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async create(
    @Body() dto: CreateEventDto,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      return await this.eventsService.create(dto, ctx.userId, ctx.roles);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('Failed to create event:', error);
      throw new HttpException(
        (error && typeof error === 'object' && 'message' in error ? (error as Error).message : null) || 'Failed to create event',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an event' })
  @ApiParam({ name: 'id', description: 'Event UUID' })
  @ApiResponse({ status: 200, description: 'The event has been updated' })
  @ApiResponse({ status: 404, description: 'Event not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateEventDto,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      return await this.eventsService.update(id, dto, ctx.userId, ctx.roles);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Failed to update event ${id}:`, error);
      throw new HttpException(
        (error && typeof error === 'object' && 'message' in error ? (error as Error).message : null) || 'Failed to update event',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an event' })
  @ApiParam({ name: 'id', description: 'Event UUID' })
  @ApiResponse({ status: 200, description: 'The event has been deleted' })
  @ApiResponse({ status: 404, description: 'Event not found' })
  async remove(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      await this.eventsService.remove(id, ctx.userId, ctx.roles);
      return { message: 'Event deleted successfully' };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Failed to delete event ${id}:`, error);
      throw new HttpException('Failed to delete event', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
