import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react'
import { collectionStyleStorageKey, collectionStyles, noteStyleStorageKey, noteStyles, paletteStorageKey, readPalette, readStyle, readThemePreference, resolveTheme, themeStorageKey, type ThemeMode, type ThemePreference } from './theme'

type ThemeContextValue = {
  preference: ThemePreference
  resolvedTheme: ThemeMode
  palettes: Record<ThemeMode, string>
  setPreference: (value: ThemePreference) => void
  setPalette: (mode: ThemeMode, id: string) => void
  noteStyle: string
  collectionStyle: string
  setNoteStyle: (id: string) => void
  setCollectionStyle: (id: string) => void
}
export const ThemeContext = createContext<ThemeContextValue | null>(null)
const darkScheme = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, updatePreference] = useState(readThemePreference)
  const [dark, setDark] = useState(darkScheme)
  const [palettes, setPalettes] = useState<Record<ThemeMode, string>>(() => ({ light: readPalette('light'), dark: readPalette('dark') }))
  const [noteStyle, updateNoteStyle] = useState(() => readStyle(noteStyleStorageKey, noteStyles))
  const [collectionStyle, updateCollectionStyle] = useState(() => readStyle(collectionStyleStorageKey, collectionStyles))
  const resolvedTheme = resolveTheme(preference, dark)
  const palette = palettes[resolvedTheme]

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.dataset.palette = palette
    document.documentElement.style.colorScheme = resolvedTheme
  }, [resolvedTheme, palette])

  useLayoutEffect(() => {
    document.documentElement.dataset.noteStyle = noteStyle
    document.documentElement.dataset.collectionStyle = collectionStyle
  }, [noteStyle, collectionStyle])

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

  function setPalette(mode: ThemeMode, id: string) {
    setPalettes((current) => ({ ...current, [mode]: id }))
    try { localStorage.setItem(paletteStorageKey[mode], id) } catch { /* Palette remains usable without persistence. */ }
  }

  function setNoteStyle(id: string) {
    updateNoteStyle(id)
    try { localStorage.setItem(noteStyleStorageKey, id) } catch { /* Style remains usable without persistence. */ }
  }

  function setCollectionStyle(id: string) {
    updateCollectionStyle(id)
    try { localStorage.setItem(collectionStyleStorageKey, id) } catch { /* Style remains usable without persistence. */ }
  }

  return <ThemeContext.Provider value={{ preference, resolvedTheme, palettes, setPreference, setPalette, noteStyle, collectionStyle, setNoteStyle, setCollectionStyle }}>{children}</ThemeContext.Provider>
}
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme requires ThemeProvider')
  return context
}
