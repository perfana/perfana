/**
 * `localStorage` for per-viewer conveniences (a dismissed banner, a remembered toggle).
 *
 * Every access is SSR-guarded and wrapped in try/catch: storage can be missing on the server,
 * blocked by the browser, full, or hold a value an older build wrote in another shape. A read that
 * fails returns `fallback`; a write that fails is dropped. Nothing that has to persist reliably
 * belongs here.
 *
 * Same shape as the private helpers in `hooks/usePinnedSystems.ts`, which is a follow-up to move
 * onto this module.
 */

export function readFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeToStorage(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable — a convenience, so silently ignore.
  }
}

export function removeFromStorage(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Unavailable — nothing to remove.
  }
}
