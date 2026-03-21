'use client';

import { useState, useCallback, useEffect } from 'react';

interface UsePinnedSystemsOptions {
  userId?: string;
  organizationId?: string | null;
}

function getStorageKey(userId: string, organizationId: string | null | undefined): string {
  const orgPart = organizationId ?? 'default';
  return `perfana_pinned_systems_${userId}_${orgPart}`;
}

function readFromStorage(key: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed);
    return new Set();
  } catch {
    return new Set();
  }
}

function writeToStorage(key: string, ids: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

export function usePinnedSystems({ userId, organizationId }: UsePinnedSystemsOptions) {
  const [pinnedSystemIds, setPinnedSystemIds] = useState<Set<string>>(() => {
    if (!userId) return new Set();
    return readFromStorage(getStorageKey(userId, organizationId));
  });

  // Re-read when userId or organizationId changes
  useEffect(() => {
    if (!userId) {
      setPinnedSystemIds(new Set());
      return;
    }
    setPinnedSystemIds(readFromStorage(getStorageKey(userId, organizationId)));
  }, [userId, organizationId]);

  const isPinned = useCallback(
    (systemId: string) => pinnedSystemIds.has(systemId),
    [pinnedSystemIds],
  );

  const togglePin = useCallback(
    (systemId: string) => {
      if (!userId) return;
      setPinnedSystemIds((prev) => {
        const next = new Set(prev);
        if (next.has(systemId)) {
          next.delete(systemId);
        } else {
          next.add(systemId);
        }
        writeToStorage(getStorageKey(userId, organizationId), next);
        return next;
      });
    },
    [userId, organizationId],
  );

  return { pinnedSystemIds, isPinned, togglePin };
}
