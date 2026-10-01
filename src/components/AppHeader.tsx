import { useEffect, useId, useRef, useState } from 'react'

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
    }}>Scratch</a>
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
    <AddMenu onAddNote={onAddNote} onAddCollection={onAddCollection} />
    <button className="icon-button header-settings" type="button" aria-label="Settings" onClick={onSettings}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M10 2h4l.5 2.2 1.8.8 2-.9 2.8 2.8-.9 2 .8 1.8L23 11v4l-2.2.5-.8 1.8.9 2-2.8 2.8-2-.9-1.8.8L14 23h-4l-.5-2.2-1.8-.8-2 .9-2.8-2.8.9-2-.8-1.8L1 15v-4l2.2-.5.8-1.8-.9-2 2.8-2.8 2 .9 1.8-.8z" transform="translate(0 -1) scale(1 .96)"/></svg>
    </button>
  </div></header>
}

// Offers only the creation actions that are wired, so no control does nothing.
function AddMenu({ onAddNote, onAddCollection }: Pick<Props, 'onAddNote' | 'onAddCollection'>) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function away(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  function choose(action: (() => void) | undefined) {
    setOpen(false)
    action?.()
  }

  return <div className="header-add-wrap" ref={root} onKeyDown={(event) => {
    if (event.key !== 'Escape' || !open) return
    event.stopPropagation()
    setOpen(false)
    toggle.current?.focus()
  }}>
    <button ref={toggle} className="primary-button header-add" type="button" aria-label="Add" aria-expanded={open} aria-controls={open ? id : undefined} disabled={!onAddNote && !onAddCollection} onClick={() => setOpen(!open)}>+ Add</button>
    {open && <div id={id} className="add-menu">
      {onAddNote && <button type="button" onClick={() => choose(onAddNote)}>Add note</button>}
      {onAddCollection && <button type="button" onClick={() => choose(onAddCollection)}>Add collection</button>}
    </div>}
  </div>
}
