import { Logo } from './Logo'

type Props = {
  onAddNote?: () => void
  onAddCollection?: () => void
  onSettings?: () => void
  // Routes the wordmark through the app's navigation guards when provided.
  onHome?: () => void
  // Controlled, ephemeral search text; the input is inert when no handler exists.
  searchValue?: string
  onSearchChange?: (value: string) => void
}

export function AppHeader({ onAddNote, onAddCollection, onSettings, onHome, searchValue, onSearchChange }: Props) {
  return <header className="app-header"><div className="header-inner">
    <a className="wordmark" href="#/" aria-label="Scratch home" onClick={(event) => {
      if (!onHome || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      onHome()
    }}><Logo className="wordmark-logo" />Scratch</a>
    <label className="header-search"><span className="visually-hidden">Search</span><input
      type="search"
      placeholder="Search"
      aria-label="Search"
      autoComplete="off"
      spellCheck={false}
      value={onSearchChange ? searchValue ?? '' : undefined}
      onChange={onSearchChange && ((event) => onSearchChange(event.target.value))}
      onKeyDown={(event) => { if (event.key === 'Escape' && onSearchChange && searchValue) onSearchChange('') }}
    /></label>
    {(onAddNote || onAddCollection) && <div className="header-actions">
      {onAddNote && <button className="primary-button header-add-note" type="button" aria-label="New note" onClick={onAddNote}>+ Note</button>}
      {onAddCollection && <button className="primary-button header-add-collection" type="button" aria-label="New collection" onClick={onAddCollection}>+ Collection</button>}
    </div>}
    <button className="icon-button header-settings" type="button" aria-label="Settings" onClick={onSettings}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
    </button>
  </div></header>
}
