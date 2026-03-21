'use client';

import { ThemeProvider } from '@mui/material/styles';
import { CssBaseline } from '@mui/material';
import { ThemeContextProvider, useThemeMode } from '@/contexts/theme-context';
import { getTheme } from '@/lib/theme';

interface MUIThemeProviderProps {
  children: React.ReactNode;
}

function ThemeProviderInner({ children }: { children: React.ReactNode }) {
  const { mode } = useThemeMode();
  return (
    <ThemeProvider theme={getTheme(mode)}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}

export function MUIThemeProvider({ children }: MUIThemeProviderProps) {
  return (
    <ThemeContextProvider>
      <ThemeProviderInner>
        {children}
      </ThemeProviderInner>
    </ThemeContextProvider>
  );
}
