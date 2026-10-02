import { useContext } from 'react'
import { ThemeContext } from './ThemeProvider'
import { collectionStyles, noteStyles, palettes, type ThemePreference } from './theme'

const CHOICES: { value: ThemePreference, label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

// Theme (System, Light, or Dark) plus the color schemes of the active mode. Each swatch paints
// itself from the real palette tokens through its own data-palette attribute.
// The choices are the only things saved about appearance.
// Renders nothing when no ThemeProvider is mounted (the app always mounts one).
export function ThemeSetting() {
  const theme = useContext(ThemeContext)
  if (!theme) return null
  const mode = theme.resolvedTheme
  const label = mode === 'dark' ? 'Dark Colors' : 'Light Colors'
  return <section className="settings-section" aria-labelledby="settings-appearance">
    <h3 id="settings-appearance">Appearance</h3>
    <div className="settings-field">
      <p id="settings-theme" className="settings-label">Theme</p>
      <div role="radiogroup" aria-labelledby="settings-theme" className="segmented">
        {CHOICES.map((choice) => <label key={choice.value} className="segment">
          <input type="radio" name="theme" value={choice.value} checked={theme.preference === choice.value} onChange={() => theme.setPreference(choice.value)} />
          <span>{choice.label}</span>
        </label>)}
      </div>
    </div>
    <div className="settings-field">
      <p id="settings-palette" className="settings-label">{label}</p>
      <div role="radiogroup" aria-labelledby="settings-palette" className="palette-grid">
        {palettes[mode].map((palette) => <label key={palette.id} className="palette-choice">
          <input type="radio" name={`palette-${mode}`} value={palette.id} checked={theme.palettes[mode] === palette.id} onChange={() => theme.setPalette(mode, palette.id)} />
          <span className="palette-swatch" data-palette={palette.id} aria-hidden="true"><i className="swatch-card" /><i className="swatch-action" /></span>
          <span className="palette-name">{palette.label}</span>
        </label>)}
      </div>
    </div>
    <div className="settings-field">
      <p id="settings-note-style" className="settings-label">Notes</p>
      <div role="radiogroup" aria-labelledby="settings-note-style" className="palette-grid" data-count={noteStyles.length}>
        {noteStyles.map((style) => <label key={style.id} className="palette-choice">
          <input type="radio" name="note-style" value={style.id} checked={theme.noteStyle === style.id} onChange={() => theme.setNoteStyle(style.id)} />
          <span className="style-preview" data-style={`note-${style.id}`} aria-hidden="true"><i /></span>
          <span className="palette-name">{style.label}</span>
        </label>)}
      </div>
    </div>
    <div className="settings-field">
      <p id="settings-collection-style" className="settings-label">Collections</p>
      <div role="radiogroup" aria-labelledby="settings-collection-style" className="palette-grid" data-count={collectionStyles.length}>
        {collectionStyles.map((style) => <label key={style.id} className="palette-choice">
          <input type="radio" name="collection-style" value={style.id} checked={theme.collectionStyle === style.id} onChange={() => theme.setCollectionStyle(style.id)} />
          <span className="style-preview" data-style={`collection-${style.id}`} aria-hidden="true"><i /></span>
          <span className="palette-name">{style.label}</span>
        </label>)}
      </div>
    </div>
  </section>
}
