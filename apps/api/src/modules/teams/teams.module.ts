import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TeamsController } from './teams.controller';
import { TeamMembersController } from './team-members.controller';
import { TeamsService } from './teams.service';
import { TeamMembersService } from './team-members.service';
import { Team, TeamMember } from '../../entities';
import { CommonModule } from '../../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { AuditResourceRegistry } from '../audit/audit-resource-registry';

@Module({
  imports: [
    TypeOrmModule.forFeature([Team, TeamMember]),
    CommonModule, // Provides AuthorizationService for team-level access controls
    AuthModule, // Provides KeycloakAdminService for user search
    AuditModule, // Phase 5a: provides AuditService + AuditResourceRegistry
  ],
  controllers: [TeamsController, TeamMembersController],
  providers: [TeamsService, TeamMembersService],
  exports: [TeamsService, TeamMembersService],
})
export class TeamsModule implements OnModuleInit {
  constructor(private readonly auditRegistry: AuditResourceRegistry) {}

  onModuleInit(): void {
    this.auditRegistry.register('teams', Team);
    this.auditRegistry.register('team-members', TeamMember);
  }
}
