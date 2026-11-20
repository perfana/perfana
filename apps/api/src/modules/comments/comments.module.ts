import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TestRunComment, TestRunCommentRead } from '@perfana/shared/entities';
import { AuditModule } from '../audit/audit.module';
import { AuditResourceRegistry } from '../audit/audit-resource-registry';
import { CommonModule } from '../../common/common.module';
import { TestRunsModule } from '../test-runs/test-runs.module';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';

@Module({
  // autoLoadEntities: an entity no module declares here has no metadata at runtime.
  imports: [TypeOrmModule.forFeature([TestRunComment, TestRunCommentRead]), CommonModule, TestRunsModule, AuditModule],
  controllers: [CommentsController],
  providers: [CommentsService],
})
export class CommentsModule implements OnModuleInit {
  constructor(private readonly auditRegistry: AuditResourceRegistry) {}

  onModuleInit(): void {
    this.auditRegistry.register('test-run-comments', TestRunComment);
  }
}
