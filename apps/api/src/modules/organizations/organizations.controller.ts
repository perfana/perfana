import { Controller, Get, Post, Put, Delete, Param, Body, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { OrganizationsService, CreateOrganizationDto, UpdateOrganizationDto } from './organizations.service';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';

@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  private readonly logger = new Logger(OrganizationsController.name);

  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all organizations the user has access to' })
  @ApiResponse({ status: 200, description: 'Return all accessible organizations' })
  async findAll(@UserCtx() ctx: UserContext) {
    try {
      this.logger.debug(`User ${ctx.userId} fetching all organizations`);
      return await this.organizationsService.findAll(ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error('Failed to fetch organizations:', error);
      throw new HttpException(
        'Failed to fetch organizations',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single organization by ID' })
  @ApiParam({ name: 'id', description: 'Organization UUID' })
  @ApiResponse({ status: 200, description: 'Return the organization' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async findOne(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    try {
      this.logger.debug(`User ${ctx.userId} fetching organization ${id}`);
      return await this.organizationsService.findOne(id, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error('Failed to fetch organization:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to fetch organization',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create a new organization' })
  @ApiResponse({ status: 201, description: 'Organization created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async create(
    @Body() createOrganizationDto: CreateOrganizationDto,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      this.logger.debug(`User ${ctx.userId} creating organization: ${createOrganizationDto.name}`);
      return await this.organizationsService.create(createOrganizationDto, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error('Failed to create organization:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to create organization',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an existing organization' })
  @ApiParam({ name: 'id', description: 'Organization UUID' })
  @ApiResponse({ status: 200, description: 'Organization updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async update(
    @Param('id') id: string,
    @Body() updateOrganizationDto: UpdateOrganizationDto,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      this.logger.debug(`User ${ctx.userId} updating organization ${id}`);
      return await this.organizationsService.update(id, updateOrganizationDto, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error('Failed to update organization:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to update organization',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an organization' })
  @ApiParam({ name: 'id', description: 'Organization UUID' })
  @ApiResponse({ status: 200, description: 'Organization deleted successfully' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async remove(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    try {
      this.logger.debug(`User ${ctx.userId} deleting organization ${id}`);
      await this.organizationsService.remove(id, ctx.userId, ctx.roles);
      return { message: 'Organization deleted successfully' };
    } catch (error) {
      this.logger.error('Failed to delete organization:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to delete organization',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}