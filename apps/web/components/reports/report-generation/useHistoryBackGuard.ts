import { useEffect, useRef } from 'react';

const GUARD_MARKER = '__perfanaUnsavedDialogGuard';

const guardTokenOf = (state: unknown): unknown =>
  state && typeof state === 'object' ? (state as Record<string, unknown>)[GUARD_MARKER] : undefined;

let nextToken = 0;

/**
 * While `active`, the browser's Back button calls `onBack` instead of leaving the page, and a
 * reload or tab close asks the browser's own "leave site?" question.
 *
 * It works by pushing one extra history entry for the current URL. Back pops that entry, which
 * fires `popstate` on the same URL, so the page stays put; the guard pushes the entry again (so a
 * second Back is caught too) and hands over to `onBack`. The pushed state spreads the current
 * one, so Next's App Router finds its own keys on it and treats the pop as a same-page no-op.
 *
 * When the guard is released (`active` turns false: the changes were saved, discarded, or the
 * dialog closed) and its entry is still the current one, it steps back over it, so the user is not
 * left with a duplicate entry to Back through. When the page navigated somewhere else, the current
 * entry is not the guard's and nothing is popped.
 */
export function useHistoryBackGuard(active: boolean, onBack: () => void) {
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    if (!active || typeof window === 'undefined') return;

    // Each arming has its own token, so an entry left behind by an earlier guard (one whose release
    // was overtaken by a router replaceState, say) is not mistaken for this one.
    const token = `guard-${nextToken++}`;
    const arm = () => {
      const current = window.history.state as Record<string, unknown> | null;
      window.history.pushState({ ...(current ?? {}), [GUARD_MARKER]: token }, '', window.location.href);
    };
    arm();

    const handlePopState = (event: PopStateEvent) => {
      // Landing ON this guard's entry (Forward) is not a Back.
      if (guardTokenOf(event.state) === token) return;
      arm();
      onBackRef.current();
    };
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome before 119 needs returnValue set; the text itself is never shown.
      event.returnValue = '';
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (guardTokenOf(window.history.state) === token) window.history.back();
    };
  }, [active]);
}
