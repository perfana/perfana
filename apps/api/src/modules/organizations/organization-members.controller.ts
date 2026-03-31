import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Logger,
  HttpException,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiProperty,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsArray, IsIn, ArrayNotEmpty } from 'class-validator';
import {
  OrganizationMembersService,
  AddOrganizationMemberDto,
} from './organization-members.service';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';
import { hasGlobalAdminRole, OrganizationRole } from '../../constants/roles.constants';

const VALID_ORG_ROLES = Object.values(OrganizationRole);

/**
 * DTO for adding a member to an organization via the API
 */
class AddMemberRequestDto {
  @ApiProperty({ description: 'User ID (Keycloak sub)', example: 'bd76d483-513b-4276-abed-66d5fca00958' })
  @IsNotEmpty()
  @IsString()
  userId!: string;

  @ApiProperty({ description: 'Roles to assign to the member', example: ['org-member'], enum: VALID_ORG_ROLES })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsIn(VALID_ORG_ROLES, { each: true })
  roles!: string[];
}

/**
 * DTO for updating organization member roles via the API
 */
class UpdateOrganizationMemberRolesDto {
  @ApiProperty({ description: 'New roles to assign', example: ['org-admin'], enum: VALID_ORG_ROLES })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsIn(VALID_ORG_ROLES, { each: true })
  roles!: string[];
}

@ApiTags('organization-members')
@ApiBearerAuth()
@Controller()
export class OrganizationMembersController {
  private readonly logger = new Logger(OrganizationMembersController.name);

  constructor(
    private readonly organizationMembersService: OrganizationMembersService,
  ) {}

  /**
   * Check if the current user has admin access to the organization
   */
  private async checkOrgAdminAccess(
    organizationId: string,
    ctx: UserContext,
  ): Promise<void> {
    // Global admins can access all organizations
    if (hasGlobalAdminRole(ctx.roles)) {
      return;
    }

    // Check if user is an org admin
    const isAdmin = await this.organizationMembersService.isOrgAdmin(
      organizationId,
      ctx.userId,
    );
    if (!isAdmin) {
      throw new ForbiddenException(
        'You do not have admin access to this organization',
      );
    }
  }

  /**
   * Check if the current user has member access to the organization
   */
  private async checkOrgMemberAccess(
    organizationId: string,
    ctx: UserContext,
  ): Promise<void> {
    // Global admins can access all organizations
    if (hasGlobalAdminRole(ctx.roles)) {
      return;
    }

    // Check if user is a member
    const isMember = await this.organizationMembersService.isMember(
      organizationId,
      ctx.userId,
    );
    if (!isMember) {
      throw new ForbiddenException(
        'You do not have access to this organization',
      );
    }
  }

  @Get('organizations/:organizationId/members')
  @ApiOperation({ summary: 'Get all members of an organization with user information' })
  @ApiParam({ name: 'organizationId', description: 'Organization UUID' })
  @ApiResponse({ status: 200, description: 'Return all organization members with enriched user data from Keycloak' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async findByOrganization(
    @Param('organizationId') organizationId: string,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      this.logger.debug(
        `User ${ctx.userId} fetching members for organization ${organizationId}`,
      );

      // Check if user has access to this organization
      await this.checkOrgMemberAccess(organizationId, ctx);

      return await this.organizationMembersService.findByOrganizationWithUserInfo(
        organizationId,
      );
    } catch (error) {
      this.logger.error('Failed to fetch organization members:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to fetch organization members',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('users/me/organizations')
  @ApiOperation({ summary: 'Get all organizations the current user belongs to' })
  @ApiResponse({ status: 200, description: 'Return all memberships for the current user' })
  async findMyOrganizations(@UserCtx() ctx: UserContext) {
    try {
      this.logger.debug(`User ${ctx.userId} fetching their organization memberships`);
      return await this.organizationMembersService.findByUser(ctx.userId);
    } catch (error) {
      this.logger.error('Failed to fetch user organization memberships:', error);
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to fetch organization memberships',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('organizations/:organizationId/members')
  @ApiOperation({ summary: 'Add a member to an organization' })
  @ApiParam({ name: 'organizationId', description: 'Organization UUID' })
  @ApiBody({ type: AddMemberRequestDto })
  @ApiResponse({ status: 201, description: 'Member added successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  @ApiResponse({ status: 409, description: 'Member already exists' })
  async addMember(
    @Param('organizationId') organizationId: string,
    @Body() body: AddMemberRequestDto,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      this.logger.debug(
        `User ${ctx.userId} adding member ${body.userId} to organization ${organizationId}`,
      );

      // Only org admins can add members
      await this.checkOrgAdminAccess(organizationId, ctx);

      const dto: AddOrganizationMemberDto = {
        organizationId,
        userId: body.userId,
        roles: body.roles,
      };
      return await this.organizationMembersService.addMember(dto);
    } catch (error) {
      this.logger.error('Failed to add organization member:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to add organization member',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('organization-members/:id')
  @ApiOperation({ summary: 'Get a single organization membership by ID' })
  @ApiParam({ name: 'id', description: 'Organization membership UUID' })
  @ApiResponse({ status: 200, description: 'Return the membership' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Membership not found' })
  async findOne(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    try {
      this.logger.debug(
        `User ${ctx.userId} fetching organization membership ${id}`,
      );

      const member = await this.organizationMembersService.findOne(id);

      // Check if user has access to this organization
      await this.checkOrgMemberAccess(member.organization_id, ctx);

      return member;
    } catch (error) {
      this.logger.error('Failed to fetch organization membership:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to fetch organization membership',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put('organization-members/:id/roles')
  @ApiOperation({ summary: 'Update the roles of an organization member' })
  @ApiParam({ name: 'id', description: 'Organization membership UUID' })
  @ApiResponse({ status: 200, description: 'Roles updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Membership not found' })
  async updateRoles(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationMemberRolesDto,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      this.logger.debug(
        `User ${ctx.userId} updating roles for organization membership ${id}`,
      );

      // Get the membership first to check organization access
      const existingMember = await this.organizationMembersService.findOne(id);

      // Only org admins can update member roles
      await this.checkOrgAdminAccess(existingMember.organization_id, ctx);

      return await this.organizationMembersService.updateMemberRoles(id, dto);
    } catch (error) {
      this.logger.error('Failed to update organization member roles:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to update organization member roles',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete('organization-members/:id')
  @ApiOperation({ summary: 'Remove a member from an organization by membership ID' })
  @ApiParam({ name: 'id', description: 'Organization membership UUID' })
  @ApiResponse({ status: 200, description: 'Member removed successfully' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Membership not found' })
  async removeMember(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    try {
      this.logger.debug(
        `User ${ctx.userId} removing organization membership ${id}`,
      );

      // Get the membership first to check organization access
      const existingMember = await this.organizationMembersService.findOne(id);

      // Only org admins can remove members
      await this.checkOrgAdminAccess(existingMember.organization_id, ctx);

      await this.organizationMembersService.removeMember(id);
      return { message: 'Member removed successfully' };
    } catch (error) {
      this.logger.error('Failed to remove organization member:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to remove organization member',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete('organizations/:organizationId/members/:userId')
  @ApiOperation({ summary: 'Remove a member from an organization by user ID' })
  @ApiParam({ name: 'organizationId', description: 'Organization UUID' })
  @ApiParam({ name: 'userId', description: 'User ID (Keycloak sub or api-key:{id})' })
  @ApiResponse({ status: 200, description: 'Member removed successfully' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Membership not found' })
  async removeMemberByUser(
    @Param('organizationId') organizationId: string,
    @Param('userId') userId: string,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      this.logger.debug(
        `User ${ctx.userId} removing user ${userId} from organization ${organizationId}`,
      );

      // Only org admins can remove members
      await this.checkOrgAdminAccess(organizationId, ctx);

      await this.organizationMembersService.removeMemberByOrganizationAndUser(
        organizationId,
        userId,
      );
      return { message: 'Member removed successfully' };
    } catch (error) {
      this.logger.error('Failed to remove organization member:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to remove organization member',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
