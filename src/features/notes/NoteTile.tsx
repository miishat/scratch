import { useState } from 'react'
import { useNavigation } from '../../app/useNavigation'
import { NavLink } from '../../components/NavLink'
import { DotsIcon, LockIcon } from '../../components/TileIcons'
import type { CopyResult } from '../clipboard/copy'
import { displayTitle, pathLabel, truncateGraphemes } from '../library/display'
import type { LibraryItem } from '../library/types'
import { clearEdit, requestEdit } from './editIntent'

export const SECRET_MASK = '•'.repeat(8)
const PREVIEW_GRAPHEMES = 160

export function noteName(note: LibraryItem): string {
  return displayTitle(note) ?? (note.isSecret ? 'Untitled secret note' : 'Untitled note')
}

// Body text for the two-line preview. A derived title already shows the first
// nonblank line, so the preview continues from the line after it.
export function notePreview(note: LibraryItem): string {
  if (note.isSecret) return ''
  const lines = (note.body ?? '').slice(0, 600).split(/\r\n|\n|\r/)
  if (note.title === null) {
    const first = lines.findIndex((line) => line.trim() !== '')
    lines.splice(0, first < 0 ? lines.length : first + 1)
  }
  const joined = lines.join(' ').replace(/\s+/g, ' ').trim().replace(/[\uD800-\uDBFF]$/, '')
  return truncateGraphemes(joined, PREVIEW_GRAPHEMES)
}

type Props = {
  note: LibraryItem
  // Resolves once the copy attempt settles. Only 'denied' and 'unavailable'
  // put the tile into its manual-copy state.
  onCopy?: (note: LibraryItem) => Promise<CopyResult | void> | void
  onMenu?: (item: LibraryItem) => void
  // Titles of the containing collections, shown on search results.
  path?: string[]
}

// Open, Copy, and menu are three separate controls so activating one never
// triggers another.
export function NoteTile({ note, onCopy, onMenu, path }: Props) {
  const [copyFailed, setCopyFailed] = useState(false)
  const navigation = useNavigation()
  const name = noteName(note)
  const preview = notePreview(note)
  const base = note.isSecret && note.title !== null ? `${name}, secret note` : name
  const label = path ? `${base}, ${pathLabel(path).toLowerCase()}` : base
  const noteRoute = { collectionId: note.parentId, noteId: note.id }

  async function copy(): Promise<void> {
    setCopyFailed(false)
    const result = await onCopy?.(note)
    if (result === 'denied' || result === 'unavailable') setCopyFailed(true)
  }
  async function edit(): Promise<void> {
    requestEdit(note.id)
    if (!(await navigation.navigate(noteRoute))) clearEdit(note.id)
  }
  return <li className="tile note-tile" data-secret={note.isSecret || undefined}>
    <NavLink className="tile-link" route={noteRoute} aria-label={label}>
      <span className="tile-head">
        <span className="tile-title">{name}</span>
        {note.isSecret && <LockIcon />}
      </span>
      <span className="tile-body">
        {path && <span className="tile-path">{pathLabel(path)}</span>}
        {note.isSecret
          ? <span className="tile-secret" aria-hidden="true">{SECRET_MASK}</span>
          : preview && <span className="tile-preview">{preview}</span>}
      </span>
    </NavLink>
    <div className="tile-actions">
      <button type="button" aria-label={`Edit ${name}`} onClick={() => void edit()}>Edit</button>
      {onCopy && <button type="button" aria-label={`Copy ${name}`} onClick={() => void copy()}>Copy</button>}
      {copyFailed && <div className="tile-copy-failed" role="status">
        <span>Could not copy.</span>
        <NavLink route={noteRoute}>{note.isSecret ? 'Reveal to copy manually' : 'Select text'}</NavLink>
      </div>}
      {onMenu && <button className="icon-button" type="button" aria-label={`More actions for ${name}`} onClick={() => onMenu(note)}><DotsIcon /></button>}
    </div>
  </li>
}
