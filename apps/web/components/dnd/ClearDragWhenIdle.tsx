'use client';

import { useEffect } from 'react';
import { useDndContext } from '@dnd-kit/core';

/**
 * Ends a component's own drag state when dnd-kit has no drag. The move past the activation distance
 * and the release can land before React commits (a jittery click, a trackpad tap-and-nudge), and
 * dnd-kit then calls neither onDragEnd nor onDragCancel: both read `active` from a layout effect
 * that has not run. Render it inside the `DndContext` (apps/web/CLAUDE.md, "dnd-kit can end a drag
 * without telling the report builder").
 */
export function ClearDragWhenIdle({ dragging, onIdle }: { dragging: boolean; onIdle: () => void }) {
  const { active } = useDndContext();
  useEffect(() => {
    if (dragging && !active) onIdle();
  }, [active, dragging, onIdle]);
  return null;
}
