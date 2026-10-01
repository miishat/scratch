import { NavLink } from '../../components/NavLink'
import { DotsIcon, LockIcon, NoteIcon } from '../../components/TileIcons'
import { displayTitle, truncateGraphemes } from '../library/display'
import type { LibraryItem } from '../library/types'

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

type Props = { note: LibraryItem, onCopy?: (note: LibraryItem) => void, onMenu?: (item: LibraryItem) => void }

// Open, Copy, and menu are three separate controls so activating one never
// triggers another.
export function NoteTile({ note, onCopy, onMenu }: Props) {
  const name = noteName(note)
  const preview = notePreview(note)
  const label = note.isSecret && note.title !== null ? `${name}, secret note` : name
  return <li className="tile note-tile" data-secret={note.isSecret || undefined}>
    <NavLink className="tile-link" route={{ collectionId: note.parentId, noteId: note.id }} aria-label={label}>
      {note.isSecret ? <LockIcon /> : <NoteIcon />}
      <span className="tile-title">{name}</span>
      {note.isSecret
        ? <span className="tile-secret" aria-hidden="true">{SECRET_MASK}</span>
        : preview && <span className="tile-preview">{preview}</span>}
    </NavLink>
    {(onCopy || onMenu) && <div className="tile-actions">
      {onCopy && <button type="button" aria-label={`Copy ${name}`} onClick={() => onCopy(note)}>Copy</button>}
      {onMenu && <button className="icon-button" type="button" aria-label={`More actions for ${name}`} onClick={() => onMenu(note)}><DotsIcon /></button>}
    </div>}
  </li>
}
