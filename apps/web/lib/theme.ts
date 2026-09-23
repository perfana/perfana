import { createTheme, type Theme, type ThemeOptions } from '@mui/material/styles';
import type { ThemeMode } from '@/contexts/theme-context';

/** The palette keys that carry a readable shade. */
export const READABLE_KEYS = [
  'primary',
  'secondary',
  'success',
  'error',
  'warning',
  'info',
] as const;

export type ReadableKey = (typeof READABLE_KEYS)[number];

/**
 * The readable shade of a palette colour for a theme's mode.
 *
 * MUI's `.dark` shades are tuned to sit on a LIGHT surface. Used verbatim in dark mode they land
 * at roughly the lightness of the surface itself and the text fades out — which is exactly what
 * made the SLO tables unreadable. Prefer the `readable.*` palette entry below in `sx` (no theme
 * argument needed); use this directly only where a `Theme` is already in hand.
 */
export function readableShade(theme: Theme, key: ReadableKey): string {
  return theme.palette.mode === 'dark' ? theme.palette[key].light : theme.palette[key].dark;
}

type ReadablePalette = Record<ReadableKey, string>;

/**
 * Resolve every readable shade once, at theme construction, and hang it off the palette so a plain
 * `sx={{ color: 'readable.primary' }}` is mode-correct with no callback. The shades themselves are
 * augmentColor derivatives — this repo declares only `main` for success/warning/error — so they
 * cannot be written inline in the palette literal; they are derived from the built theme.
 */
function withReadablePalette(theme: Theme): Theme {
  const readable = Object.fromEntries(
    READABLE_KEYS.map((key) => [key, readableShade(theme, key)]),
  ) as ReadablePalette;
  return createTheme(theme, { palette: { readable } });
}

// Extend the Theme interface to include custom integrations palette
declare module '@mui/material/styles' {
  interface Palette {
    integrations: {
      grafana: string;
      dynatrace: string;
      pyroscope: string;
      tracing: string;
    };
    readable: ReadablePalette;
  }
  interface PaletteOptions {
    integrations?: {
      grafana?: string;
      dynatrace?: string;
      pyroscope?: string;
      tracing?: string;
    };
    readable?: Partial<ReadablePalette>;
  }
}

const sharedOptions: ThemeOptions = {
  typography: {
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    h4: {
      fontWeight: 600,
      fontSize: '1.875rem',
    },
    h6: {
      fontWeight: 500,
      fontSize: '1.125rem',
    },
    body2: {
      fontSize: '0.875rem',
    },
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 500,
        },
      },
    },
  },
};

const baseLightTheme = createTheme({
  ...sharedOptions,
  palette: {
    mode: 'light',
    primary: {
      main: '#2563eb',
      light: '#3b82f6',
      dark: '#1d4ed8',
    },
    secondary: {
      main: '#64748b',
    },
    success: {
      main: '#16a34a',
    },
    warning: {
      main: '#d97706',
    },
    error: {
      main: '#dc2626',
    },
    background: {
      default: '#f8fafc',
      paper: '#ffffff',
    },
    integrations: {
      grafana: '#F46800',
      dynatrace: '#1496FF',
      pyroscope: '#FF6B35',
      tracing: '#4CAF50',
    },
  },
});

const baseDarkTheme = createTheme({
  ...sharedOptions,
  components: {
    ...sharedOptions.components,
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.3), 0 1px 2px -1px rgb(0 0 0 / 0.2)',
          backgroundImage: 'none',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
  },
  palette: {
    mode: 'dark',
    primary: {
      main: '#3b82f6',
      light: '#60a5fa',
      dark: '#2563eb',
    },
    secondary: {
      main: '#94a3b8',
    },
    success: {
      main: '#22c55e',
    },
    warning: {
      main: '#f59e0b',
    },
    error: {
      main: '#ef4444',
    },
    background: {
      default: '#0f172a',
      paper: '#1e293b',
    },
    integrations: {
      grafana: '#F46800',
      dynatrace: '#1496FF',
      pyroscope: '#FF6B35',
      tracing: '#4CAF50',
    },
  },
});

export const lightTheme = withReadablePalette(baseLightTheme);
export const darkTheme = withReadablePalette(baseDarkTheme);

export function getTheme(mode: ThemeMode) {
  return mode === 'dark' ? darkTheme : lightTheme;
}
