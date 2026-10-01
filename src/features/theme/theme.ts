export type ThemePreference = 'system' | 'light' | 'dark'
export const themeStorageKey = 'scratch-theme'
export function readThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(themeStorageKey)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}
export function resolveTheme(preference: ThemePreference, dark: boolean): 'light' | 'dark' {
  return preference === 'system' ? (dark ? 'dark' : 'light') : preference
}
