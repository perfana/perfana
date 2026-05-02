import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * Enum for audit log action types
 * Phase 5a: only mutations are logged. ACCESS / ACCESS_DENIED / LOGIN / LOGOUT
 * are deferred to Phase 5c (security monitoring) when concrete monitoring
 * requirements drive their reintroduction.
 */
export enum AuditAction {
  /** Resource creation */
  CREATE = 'CREATE',
  /** Resource update */
  UPDATE = 'UPDATE',
  /** Resource deletion */
  DELETE = 'DELETE',
}

/**
 * Interface for change tracking in audit logs
 * Stores before/after snapshots for UPDATE operations
 */
export interface AuditLogChanges {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  fields?: string[];
}

/**
 * Interface for audit log metadata
 * Stores additional context about the operation
 */
export interface AuditLogMetadata {
  request_id?: string;
  correlation_id?: string;
  session_id?: string;
  auth_type?: string;
  route?: string;
  method?: string;
  duration_ms?: number;
  [key: string]: unknown;
}

/**
 * AuditLog Entity
 *
 * Comprehensive audit log for all CRUD operations in the system.
 * Part of RBAC Phase 5: Row-Level Security, Audit Logging & Hardening.
 *
 * This entity provides:
 * - Complete audit trail for compliance and debugging
 * - User activity tracking
 * - Security monitoring for access denials
 * - Resource change history with before/after snapshots
 *
 * Note: Audit logs are append-only (no UPDATE/DELETE operations expected)
 */
@Entity('audit_logs')
@Index('idx_audit_logs_timestamp', ['timestamp'])
@Index('idx_audit_logs_user_id', ['userId'])
@Index('idx_audit_logs_organization_id', ['organizationId'])
@Index('idx_audit_logs_resource', ['resourceType', 'resourceId'])
@Index('idx_audit_logs_action', ['action'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'timestamp with time zone', default: () => 'NOW()' })
  timestamp!: Date;

  @Column({ name: 'user_id', type: 'varchar', length: 255 })
  userId!: string;

  @Column({ name: 'user_email', type: 'varchar', length: 255, nullable: true })
  userEmail?: string;

  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string;

  @Column({ type: 'varchar', length: 50 })
  action!: AuditAction;

  @Column({ name: 'resource_type', type: 'varchar', length: 100 })
  resourceType!: string;

  @Column({ name: 'resource_id', type: 'varchar', length: 255, nullable: true })
  resourceId?: string;

  @Column({ name: 'resource_name', type: 'varchar', length: 255, nullable: true })
  resourceName?: string;

  @Column('jsonb', { nullable: true })
  changes?: AuditLogChanges;

  @Column('jsonb', { nullable: true })
  metadata?: AuditLogMetadata;

  @Column({ type: 'boolean', default: true })
  success!: boolean;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string;

  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress?: string;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent?: string;
}
