export type ThemePreference = 'system' | 'light' | 'dark'
export type ThemeMode = 'light' | 'dark'
export const themeStorageKey = 'scratch-theme'

export type Palette = { id: string, label: string }
// The ids match the data-palette blocks in tokens.css. The first entry of each list is the default.
export const palettes: Record<ThemeMode, Palette[]> = {
  light: [
    { id: 'parchment', label: 'Parchment' },
    { id: 'classic', label: 'Classic' },
    { id: 'rosewater', label: 'Rosewater' },
  ],
  dark: [
    { id: 'espresso', label: 'Espresso' },
    { id: 'slate', label: 'Slate' },
    { id: 'forest', label: 'Forest' },
  ],
}
export const noteStyles: Palette[] = [
  { id: 'index', label: 'Index Card' },
  { id: 'paper', label: 'Paper Sheet' },
  { id: 'sticky', label: 'Sticky Note' },
  { id: 'quiet', label: 'Quiet' },
]
export const collectionStyles: Palette[] = [
  { id: 'stacked', label: 'Stacked' },
  { id: 'classic', label: 'Classic' },
  { id: 'tab', label: 'Folder Tab' },
  { id: 'edge', label: 'Color Edge' },
]
export const noteStyleStorageKey = 'scratch-note-style'
export const collectionStyleStorageKey = 'scratch-collection-style'
export const paletteStorageKey: Record<ThemeMode, string> = { light: 'scratch-light-palette', dark: 'scratch-dark-palette' }

export function readThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(themeStorageKey)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}
export function readPalette(mode: ThemeMode): string {
  try {
    const value = localStorage.getItem(paletteStorageKey[mode])
    if (palettes[mode].some((palette) => palette.id === value)) return value as string
  } catch { /* Storage can be unavailable. */ }
  return palettes[mode][0].id
}
// A saved style that is no longer offered falls back to the first one.
export function readStyle(key: string, options: Palette[]): string {
  try {
    const value = localStorage.getItem(key)
    if (options.some((option) => option.id === value)) return value as string
  } catch { /* Storage can be unavailable. */ }
  return options[0].id
}
export function resolveTheme(preference: ThemePreference, dark: boolean): ThemeMode {
  return preference === 'system' ? (dark ? 'dark' : 'light') : preference
}
