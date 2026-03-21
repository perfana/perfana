import { createTheme, type ThemeOptions } from '@mui/material/styles';
import type { ThemeMode } from '@/contexts/theme-context';

// Extend the Theme interface to include custom integrations palette
declare module '@mui/material/styles' {
  interface Palette {
    integrations: {
      grafana: string;
      dynatrace: string;
      pyroscope: string;
      tracing: string;
    };
  }
  interface PaletteOptions {
    integrations?: {
      grafana?: string;
      dynatrace?: string;
      pyroscope?: string;
      tracing?: string;
    };
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

export const lightTheme = createTheme({
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

export const darkTheme = createTheme({
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

export function getTheme(mode: ThemeMode) {
  return mode === 'dark' ? darkTheme : lightTheme;
}

// Backward compatibility
export const theme = lightTheme;
