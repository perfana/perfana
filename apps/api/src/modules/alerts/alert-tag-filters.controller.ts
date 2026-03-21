import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { AlertTagFiltersService } from './alert-tag-filters.service';
import { CreateAlertTagFilterDto, UpdateAlertTagFilterDto } from './dto/alert-tag-filter.dto';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';

@ApiTags('alert-tag-filters')
@Controller('alert-tag-filters')
@ApiBearerAuth()
export class AlertTagFiltersController {
  private readonly logger = new Logger(AlertTagFiltersController.name);

  constructor(private readonly filtersService: AlertTagFiltersService) {}

  @Get()
  @ApiOperation({ summary: 'List all alert tag filters' })
  @ApiResponse({ status: 200, description: 'Return all alert tag filters' })
  async findAll(@UserCtx() ctx: UserContext) {
    try {
      return await this.filtersService.findAll(ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error('Failed to fetch alert tag filters:', error);
      throw new HttpException('Failed to fetch alert tag filters', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an alert tag filter by ID' })
  @ApiParam({ name: 'id', description: 'Alert tag filter UUID' })
  @ApiResponse({ status: 200, description: 'Return the filter' })
  @ApiResponse({ status: 404, description: 'Filter not found' })
  async findOne(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    try {
      return await this.filtersService.findOne(id, ctx.userId, ctx.roles);
    } catch (error) {
      if (error && typeof error === 'object' && 'message' in error && (error as Error).message.includes('not found')) {
        throw new HttpException('Filter not found', HttpStatus.NOT_FOUND);
      }
      this.logger.error(`Failed to fetch alert tag filter ${id}:`, error);
      throw new HttpException('Failed to fetch filter', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create a new alert tag filter' })
  @ApiResponse({ status: 201, description: 'The filter has been created' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async create(@Body() dto: CreateAlertTagFilterDto, @UserCtx() ctx: UserContext) {
    try {
      return await this.filtersService.create(dto, ctx.userId);
    } catch (error) {
      this.logger.error('Failed to create alert tag filter:', error);
      throw new HttpException(
        (error && typeof error === 'object' && 'message' in error ? (error as Error).message : null) || 'Failed to create filter',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an alert tag filter' })
  @ApiParam({ name: 'id', description: 'Alert tag filter UUID' })
  @ApiResponse({ status: 200, description: 'The filter has been updated' })
  @ApiResponse({ status: 404, description: 'Filter not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAlertTagFilterDto,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      return await this.filtersService.update(id, dto, ctx.userId, ctx.roles);
    } catch (error) {
      if (error && typeof error === 'object' && 'message' in error && (error as Error).message.includes('not found')) {
        throw new HttpException('Filter not found', HttpStatus.NOT_FOUND);
      }
      this.logger.error(`Failed to update alert tag filter ${id}:`, error);
      throw new HttpException(
        (error && typeof error === 'object' && 'message' in error ? (error as Error).message : null) || 'Failed to update filter',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an alert tag filter' })
  @ApiParam({ name: 'id', description: 'Alert tag filter UUID' })
  @ApiResponse({ status: 200, description: 'The filter has been deleted' })
  @ApiResponse({ status: 404, description: 'Filter not found' })
  async remove(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    try {
      await this.filtersService.remove(id, ctx.userId, ctx.roles);
      return { message: 'Filter deleted successfully' };
    } catch (error) {
      if (error && typeof error === 'object' && 'message' in error && (error as Error).message.includes('not found')) {
        throw new HttpException('Filter not found', HttpStatus.NOT_FOUND);
      }
      this.logger.error(`Failed to delete alert tag filter ${id}:`, error);
      throw new HttpException('Failed to delete filter', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
