'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'

export type ThemeMode = 'light' | 'dark'
export type ThemePreference = 'light' | 'dark' | 'auto'

interface ThemeContextType {
  mode: ThemeMode
  preference: ThemePreference
  isDark: boolean
  toggleTheme: () => void
  setMode: (mode: ThemeMode) => void
  setPreference: (preference: ThemePreference) => void
}

const STORAGE_KEY = 'perfana_theme'

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

function applyThemeToDOM(mode: ThemeMode) {
  const root = document.documentElement
  if (mode === 'dark') {
    root.classList.add('dark')
    root.setAttribute('data-theme', 'dark')
  } else {
    root.classList.remove('dark')
    root.setAttribute('data-theme', 'light')
  }
}

function getAutoMode(): ThemeMode {
  const hour = new Date().getHours()
  return (hour >= 19 || hour < 7) ? 'dark' : 'light'
}

export function ThemeContextProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('light')
  const [mode, setModeState] = useState<ThemeMode>('light')

  // On mount, read from localStorage and apply
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemePreference | null
    if (stored === 'dark' || stored === 'light' || stored === 'auto') {
      setPreferenceState(stored)
      const effectiveMode = stored === 'auto' ? getAutoMode() : stored
      setModeState(effectiveMode)
      applyThemeToDOM(effectiveMode)
    }
  }, [])

  // When in auto mode, check time every minute
  useEffect(() => {
    if (preference !== 'auto') return

    const checkTime = () => {
      const newMode = getAutoMode()
      setModeState(prev => {
        if (prev !== newMode) {
          applyThemeToDOM(newMode)
          return newMode
        }
        return prev
      })
    }

    const interval = setInterval(checkTime, 60_000)
    return () => clearInterval(interval)
  }, [preference])

  const setPreference = useCallback((newPref: ThemePreference) => {
    setPreferenceState(newPref)
    localStorage.setItem(STORAGE_KEY, newPref)
    const effectiveMode = newPref === 'auto' ? getAutoMode() : newPref
    setModeState(effectiveMode)
    applyThemeToDOM(effectiveMode)
  }, [])

  const setMode = useCallback((newMode: ThemeMode) => {
    setPreference(newMode)
  }, [setPreference])

  const toggleTheme = useCallback(() => {
    setPreference(mode === 'light' ? 'dark' : 'light')
  }, [mode, setPreference])

  const value = useMemo(() => ({
    mode,
    preference,
    isDark: mode === 'dark',
    toggleTheme,
    setMode,
    setPreference,
  }), [mode, preference, toggleTheme, setMode, setPreference])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useThemeMode() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useThemeMode must be used within a ThemeContextProvider')
  }
  return context
}
