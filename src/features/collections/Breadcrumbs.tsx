import { useEffect, useId, useRef, useState } from 'react'
import { NavLink } from '../../components/NavLink'
import type { LibraryItem } from '../library/types'

// Full ancestry on wide screens; below 600 px the short block shows a back link
// and a menu holding the whole ancestor list. CSS chooses which one is visible.
export function Breadcrumbs({ path }: { path: LibraryItem[] }) {
  const ancestors = path.slice(0, -1)
  const current = path[path.length - 1]
  const parent = ancestors[ancestors.length - 1]
  return <nav className="breadcrumbs" aria-label="Breadcrumb">
    <ol className="crumbs-full" data-testid="crumbs-full">
      <li><NavLink route={{ collectionId: null }}>Scratch</NavLink></li>
      {ancestors.map((item) => <li key={item.id}><NavLink route={{ collectionId: item.id }}>{item.title}</NavLink></li>)}
      <li><span aria-current="page">{current?.title}</span></li>
    </ol>
    <div className="crumbs-short" data-testid="crumbs-short">
      <NavLink className="crumb-back" route={{ collectionId: parent?.id ?? null }} aria-label={`Back to ${parent?.title ?? 'Scratch'}`}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
      </NavLink>
      <AncestorMenu ancestors={ancestors} />
    </div>
  </nav>
}

function AncestorMenu({ ancestors }: { ancestors: LibraryItem[] }) {
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

  return <div className="crumb-menu" ref={root} onKeyDown={(event) => {
    if (event.key !== 'Escape' || !open) return
    event.stopPropagation()
    setOpen(false)
    toggle.current?.focus()
  }}>
    <button ref={toggle} type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <span className="visually-hidden">Show ancestors</span>
      <span aria-hidden="true">Scratch / &hellip;</span>
    </button>
    {open && <ul id={id} className="crumb-list">
      <li><NavLink route={{ collectionId: null }} onNavigate={() => setOpen(false)}>Scratch</NavLink></li>
      {ancestors.map((item) => <li key={item.id}><NavLink route={{ collectionId: item.id }} onNavigate={() => setOpen(false)}>{item.title}</NavLink></li>)}
    </ul>}
  </div>
}
