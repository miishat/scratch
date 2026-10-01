import { useContext } from 'react'
import { ThemeContext } from './ThemeProvider'
import type { ThemePreference } from './theme'

const CHOICES: { value: ThemePreference, label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

// System, Light, or Dark. The choice is the only thing saved about the theme.
// Renders nothing when no ThemeProvider is mounted (the app always mounts one).
export function ThemeSetting() {
  const theme = useContext(ThemeContext)
  if (!theme) return null
  return <section aria-labelledby="settings-theme">
    <h3 id="settings-theme">Theme</h3>
    <div role="radiogroup" aria-labelledby="settings-theme" className="destination-list">
      {CHOICES.map((choice) => <label key={choice.value} className="destination">
        <input type="radio" name="theme" value={choice.value} checked={theme.preference === choice.value} onChange={() => theme.setPreference(choice.value)} />
        {choice.label}
      </label>)}
    </div>
    <p className="form-hint">System follows your device and changes with it.</p>
  </section>
}
