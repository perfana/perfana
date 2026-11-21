import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

/**
 * One step of an analysis story (migration 1830): a reference to a ROOT comment on the story's
 * run, its 1-based dense `position`, and the story author's connecting `note`. A comment appears
 * at most once per story. `comment_id` is ON DELETE NO ACTION: the service never hard-deletes a
 * comment that is a step, it soft-deletes it, and the step then reads "comment deleted".
 */
@Entity('test_run_story_steps')
@Index('idx_test_run_story_steps_comment', ['commentId'])
export class TestRunStoryStep {
  @PrimaryColumn({ name: 'story_id', type: 'uuid' })
  storyId!: string;

  @PrimaryColumn({ name: 'comment_id', type: 'uuid' })
  commentId!: string;

  @Column({ name: 'position', type: 'integer' })
  position!: number;

  @Column({ name: 'note', type: 'text', nullable: true })
  note!: string | null;

  /** Copied from the story, for RLS. */
  @Column({ type: 'uuid', name: 'organization_id' })
  organizationId!: string;
}
