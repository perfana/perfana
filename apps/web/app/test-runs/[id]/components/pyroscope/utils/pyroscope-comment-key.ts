/** Comment anchors on the Pyroscope card: an application + profiler pair and the view (single / diff). */

export const PYROSCOPE_VIEWS = ['single', 'diff'] as const;
type Combo = { application: string; profiler: string };

export const pyroscopeItemKey = (c: Combo, viewModeTab: number) =>
  JSON.stringify([c.application, c.profiler, PYROSCOPE_VIEWS[viewModeTab] ?? 'single']);

export const pyroscopeItemLabel = (c: Combo, viewModeTab: number) =>
  `${c.application} / ${c.profiler.split(':')[0]} · ${viewModeTab === 1 ? 'Diff view' : 'Single view'}`.slice(0, 255);

/**
 * Reads both the current key and the earlier `application|profiler` form, which carried no view
 * (`viewModeTab` null: leave the view as it is).
 */
export function parsePyroscopeItemKey(key: string): (Combo & { viewModeTab: number | null }) | null {
  if (key.startsWith('[')) {
    try {
      const [application, profiler, view] = JSON.parse(key) as string[];
      if (typeof application !== 'string' || typeof profiler !== 'string') return null;
      const idx = PYROSCOPE_VIEWS.indexOf(view as (typeof PYROSCOPE_VIEWS)[number]);
      return { application, profiler, viewModeTab: idx < 0 ? null : idx };
    } catch {
      return null;
    }
  }
  const bar = key.indexOf('|');
  return bar < 0 ? null : { application: key.slice(0, bar), profiler: key.slice(bar + 1), viewModeTab: null };
}

export const isComboKey = (c: Combo) => (key: string) => {
  const p = parsePyroscopeItemKey(key);
  return !!p && p.application === c.application && p.profiler === c.profiler;
};
