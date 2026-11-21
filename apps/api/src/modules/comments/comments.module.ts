import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TestRunComment, TestRunCommentRead, TestRunStory, TestRunStoryStep } from '@perfana/shared/entities';
import { AuditModule } from '../audit/audit.module';
import { AuditResourceRegistry } from '../audit/audit-resource-registry';
import { CommonModule } from '../../common/common.module';
import { TestRunsModule } from '../test-runs/test-runs.module';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { StoriesService } from './stories.service';

@Module({
  // autoLoadEntities: an entity no module declares here has no metadata at runtime.
  imports: [TypeOrmModule.forFeature([TestRunComment, TestRunCommentRead, TestRunStory, TestRunStoryStep]), CommonModule, TestRunsModule, AuditModule],
  controllers: [CommentsController],
  providers: [CommentsService, StoriesService],
})
export class CommentsModule implements OnModuleInit {
  constructor(private readonly auditRegistry: AuditResourceRegistry) {}

  onModuleInit(): void {
    this.auditRegistry.register('test-run-comments', TestRunComment);
    this.auditRegistry.register('test-run-stories', TestRunStory);
  }
}
