import React from 'react';
import { Tooltip } from '@mui/material';
import { usePermissions } from '@/hooks/usePermissions';

export interface RequiresPermissionProps {
  /** Capability action string (e.g. 'integration:dynatrace:update'). */
  action: string;
  /** Org context for the capability check. Pass currentOrganizationId from useOrganizationContext at the call site. */
  orgId?: string;
  /** Per-resource permissions hint — takes precedence over capabilities when provided. Read from a resource's _permissions field. */
  resourcePermissions?: Record<string, boolean>;
  /** Tooltip text shown on hover when disabled. Default: "Org admin only". */
  disabledReason?: string;
  /** The child to render. Single element only — no fragment children. */
  children: React.ReactElement;
}

/**
 * Declarative permission gate (v1: disabled-with-tooltip only).
 *
 * When the user has the required capability the child is rendered unmodified.
 * When they lack it the child is disabled and wrapped in a MUI Tooltip so the
 * reason is visible on hover.
 *
 * Note: MUI's Tooltip cannot anchor on a disabled element directly — we wrap
 * in a <span> so the tooltip trigger stays focusable/hoverable.
 */
export function RequiresPermission({
  action,
  orgId,
  resourcePermissions,
  disabledReason = 'Org admin only',
  children,
}: RequiresPermissionProps) {
  const { can } = usePermissions();
  const allowed = can(action, { organizationId: orgId, resourcePermissions });

  if (allowed) return children;

  const disabledChild = React.cloneElement(children, {
    disabled: true,
    'aria-disabled': true,
    onClick: (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    },
  });

  return (
    <Tooltip title={disabledReason}>
      {/* MUI Tooltip needs a non-disabled wrapper to receive pointer events. */}
      <span>{disabledChild}</span>
    </Tooltip>
  );
}
