import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * A comment on a card of the test-run details page (migration 1827; design:
 * docs/designs/test-run-comments.md). Threads are one level deep: `parentId` null is a root,
 * otherwise a reply whose parent is a root on the same run and card.
 *
 * A marker is a root with `markerSeq`/`markerTime`/`chartContext` set (Graphs card, PR2).
 * Delete rule: a marker root or a root with replies is soft-deleted (`deletedAt` set, `body`
 * wiped to ''); a plain root and any reply are hard-deleted.
 */
@Entity('test_run_comments')
@Index('idx_test_run_comments_run_created', ['testRunId', 'createdAt'])
@Index('idx_test_run_comments_parent', ['parentId'])
export class TestRunComment {
  /** Audited on delete only: a delete may be an org admin moderating someone else's comment. */
  static auditableFields = ['testRunId', 'cardKey', 'parentId', 'authorId', 'authorName', 'body', 'itemKey', 'markerSeq'] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The run's uuid primary key (`test_runs.id`), not the human `test_run_id`. */
  @Column({ name: 'test_run_id', type: 'uuid' })
  testRunId!: string;

  @Column({ name: 'card_key', type: 'varchar', length: 64 })
  cardKey!: string;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId!: string | null;

  @Column({ name: 'body', type: 'text' })
  body!: string;

  @Column({ name: 'author_id', type: 'varchar', length: 255 })
  authorId!: string;

  @Column({ name: 'author_name', type: 'varchar', length: 255 })
  authorName!: string;

  /** The card item a root is anchored to (row key built by the web card); null = whole card. */
  @Column({ name: 'item_key', type: 'varchar', length: 1024, nullable: true })
  itemKey!: string | null;

  /** What the anchored item was called when the comment was written. */
  @Column({ name: 'item_label', type: 'varchar', length: 255, nullable: true })
  itemLabel!: string | null;

  @Column({ name: 'marker_seq', type: 'integer', nullable: true })
  markerSeq!: number | null;

  @Column({ name: 'marker_time', type: 'timestamptz', nullable: true })
  markerTime!: Date | null;

  @Column({ name: 'chart_context', type: 'jsonb', nullable: true })
  chartContext!: Record<string, unknown> | null;

  @Column({ type: 'uuid', name: 'organization_id' })
  organizationId!: string;

  @Column({ type: 'uuid', nullable: true, name: 'team_id' })
  teamId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;

  @Column({ name: 'edited_at', type: 'timestamptz', nullable: true })
  editedAt!: Date | null;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  /** Set by the API's notification sweep when it claims the comment for a channel post (PR3). */
  @Column({ name: 'notified_at', type: 'timestamptz', nullable: true })
  notifiedAt!: Date | null;

  /** Set when the sweep released this comment after a transient failure; skipped until then. */
  @Column({ name: 'notify_after', type: 'timestamptz', nullable: true })
  notifyAfter!: Date | null;
}
