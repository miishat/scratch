import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react'
import { readThemePreference, resolveTheme, themeStorageKey, type ThemePreference } from './theme'

type ThemeContextValue = { preference: ThemePreference, resolvedTheme: 'light' | 'dark', setPreference: (value: ThemePreference) => void }
export const ThemeContext = createContext<ThemeContextValue | null>(null)
const darkScheme = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, updatePreference] = useState(readThemePreference)
  const [dark, setDark] = useState(darkScheme)
  const resolvedTheme = resolveTheme(preference, dark)

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.style.colorScheme = resolvedTheme
  }, [resolvedTheme])

  useLayoutEffect(() => {
    if (preference !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (event: MediaQueryListEvent) => setDark(event.matches)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [preference])

  function setPreference(value: ThemePreference) {
    if (value === 'system') setDark(darkScheme())
    updatePreference(value)
    try { localStorage.setItem(themeStorageKey, value) } catch { /* Theme remains usable without persistence. */ }
  }

  return <ThemeContext.Provider value={{ preference, resolvedTheme, setPreference }}>{children}</ThemeContext.Provider>
}
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme requires ThemeProvider')
  return context
}
