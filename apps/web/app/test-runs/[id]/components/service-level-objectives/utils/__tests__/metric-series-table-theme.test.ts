/**
 * The theme-aware half of the metric-series table's styling.
 *
 * MUI's `.dark` palette shades are tuned to sit on a LIGHT surface. Used verbatim in dark mode
 * they land at roughly the lightness of the surface itself and the text disappears, which is the
 * whole reason `readableShade` exists. These tests assert the mode split in both directions —
 * a helper that returned `.dark` unconditionally would still "work", and still be unreadable.
 */
import { createTheme } from '@mui/material/styles';
import { lightTheme, darkTheme } from '@/lib/theme';
import {
  readableShade,
  getHeaderTextSx,
  getChipColorsForTheme,
  getThemedChipStyles,
} from '../metric-series-table-utils';

const light = createTheme({ palette: { mode: 'light' } });
const dark = createTheme({ palette: { mode: 'dark' } });

/**
 * Relative lightness of a shade, enough to compare two shades of one hue.
 *
 * Accepts `#rrggbb` AND `rgb(r, g, b)`: the app's own themes declare success/warning/error with
 * `main` only, so MUI's augmentColor derives `.light`/`.dark` as `rgb(...)` strings. A hex-only
 * parser silently restricted these assertions to MUI's default palette.
 */
function lightness(color: string): number {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return (0.299 * ((n >> 16) & 0xff) + 0.587 * ((n >> 8) & 0xff) + 0.114 * (n & 0xff)) / 255;
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(color.trim());
  if (!rgb) throw new Error(`not a hex or rgb colour: ${color}`);
  return (0.299 * Number(rgb[1]) + 0.587 * Number(rgb[2]) + 0.114 * Number(rgb[3])) / 255;
}

/** The alpha channel of an `rgba(r, g, b, a)` string. */
function alphaOf(rgba: string): number {
  const m = /rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/.exec(rgba);
  if (!m) throw new Error(`not an rgba colour: ${rgba}`);
  return Number(m[1]);
}

const KEYS = ['primary', 'success', 'error', 'warning'] as const;

describe('readableShade', () => {
  it('picks .dark in light mode and .light in dark mode, for every palette key', () => {
    for (const key of KEYS) {
      expect(readableShade(light, key)).toBe(light.palette[key].dark);
      expect(readableShade(dark, key)).toBe(dark.palette[key].light);
      // Not merely a different string: the dark-mode shade has to be the LIGHTER one,
      // which is what makes it legible against a dark surface.
      expect(lightness(readableShade(dark, key))).toBeGreaterThan(lightness(dark.palette[key].dark));
    }
  });

  it('does not fall back to the light-mode shade when the mode is dark', () => {
    // The regression this guards: `theme.palette[key].dark` hard-coded, as every call site had it.
    for (const key of KEYS) {
      expect(readableShade(dark, key)).not.toBe(dark.palette[key].dark);
    }
  });
});

describe('getHeaderTextSx', () => {
  it('colours the column headers with the readable shade for the mode and keeps the type styling', () => {
    expect(getHeaderTextSx(light).color).toBe(light.palette.primary.dark);
    expect(getHeaderTextSx(dark).color).toBe(dark.palette.primary.light);

    const sx = getHeaderTextSx(light);
    expect(sx.fontWeight).toBe(700);
    expect(sx.textTransform).toBe('uppercase');
    expect(sx.fontSize).toBe('0.85rem');
  });
});

describe('getChipColorsForTheme', () => {
  const STATUSES = ['warning', 'success', 'error'] as const;

  it('tints the chip more strongly in dark mode than in light, for every status', () => {
    for (const status of STATUSES) {
      const l = getChipColorsForTheme(light)[status];
      const d = getChipColorsForTheme(dark)[status];

      expect(alphaOf(d.background)).toBeGreaterThan(alphaOf(l.background));
      expect(alphaOf(d.backgroundHover)).toBeGreaterThan(alphaOf(l.backgroundHover));
      // Hover is always the stronger of the pair, in both modes.
      expect(alphaOf(l.backgroundHover)).toBeGreaterThan(alphaOf(l.background));
      expect(alphaOf(d.backgroundHover)).toBeGreaterThan(alphaOf(d.background));
    }
  });

  it('writes the chip label in the mode-appropriate shade', () => {
    for (const status of STATUSES) {
      expect(getChipColorsForTheme(light)[status].color).toBe(light.palette[status].dark);
      expect(getChipColorsForTheme(dark)[status].color).toBe(dark.palette[status].light);
    }
  });

  it('emits a flat tint rather than a gradient', () => {
    // The old value was a three-stop `linear-gradient(...)` whose stops differed by 0.02 alpha:
    // invisible, and it defeated any attempt to reason about the chip's contrast.
    for (const status of STATUSES) {
      for (const theme of [light, dark]) {
        const colors = getChipColorsForTheme(theme)[status];
        expect(colors.background).not.toContain('gradient');
        expect(colors.backgroundHover).not.toContain('gradient');
        expect(colors.background).toMatch(/^rgba\(/);
      }
    }
  });

  it('borders track the same mode split and stay under the hover border', () => {
    for (const status of STATUSES) {
      const l = getChipColorsForTheme(light)[status];
      const d = getChipColorsForTheme(dark)[status];
      expect(alphaOf(d.border)).toBeGreaterThan(alphaOf(l.border));
      expect(alphaOf(l.borderHover)).toBeGreaterThan(alphaOf(l.border));
      expect(alphaOf(d.borderHover)).toBeGreaterThan(alphaOf(d.border));
    }
  });
});

describe('getThemedChipStyles', () => {
  it('maps pass/fail/error onto the success/error/warning tints in both modes', () => {
    for (const theme of [light, dark]) {
      const colors = getChipColorsForTheme(theme);
      expect(getThemedChipStyles('pass', false, theme).color).toBe(colors.success.color);
      expect(getThemedChipStyles('fail', false, theme).color).toBe(colors.error.color);
      expect(getThemedChipStyles('error', false, theme).color).toBe(colors.warning.color);
    }
  });

  it('gives a stale chip the warning tint but plain text colour, and only an error chip the help cursor', () => {
    const stale = getThemedChipStyles('pass', true, dark);
    expect(stale.background).toBe(getChipColorsForTheme(dark).warning.background);
    expect(stale.color).toBe(dark.palette.text.primary);
    expect(stale.cursor).toBe('default');
    expect(getThemedChipStyles('error', false, dark).cursor).toBe('help');
  });

  it('no longer writes a fail chip in the raw .main shade', () => {
    // The error entry used `theme.palette.error.main` where every sibling used `.dark`; on a pale
    // error tint that was the lowest-contrast label in the table.
    expect(getThemedChipStyles('fail', false, light).color).toBe(light.palette.error.dark);
    expect(getThemedChipStyles('fail', false, light).color).not.toBe(light.palette.error.main);
  });
});

/**
 * The same contract against the themes the app actually ships (apps/web/lib/theme.ts), not MUI's
 * defaults. This is the pair that the user reported as unreadable, so it is the pair that has to
 * be asserted; the suites above would pass on a palette nobody ever sees.
 */
describe('readableShade against the shipped themes', () => {
  it.each([
    ['lightTheme', lightTheme, 'dark'],
    ['darkTheme', darkTheme, 'light'],
  ] as const)('picks the readable shade for every key in %s', (_name, theme, shade) => {
    for (const key of KEYS) {
      expect(readableShade(theme, key)).toBe(theme.palette[key][shade]);
    }
  });

  it('gives the dark theme the lighter shade of each hue', () => {
    for (const key of KEYS) {
      expect(lightness(readableShade(darkTheme, key))).toBeGreaterThan(
        lightness(darkTheme.palette[key].dark),
      );
    }
  });
});
