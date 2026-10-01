import { useEffect, useState } from 'react'
import type { LibraryItem } from '../library/types'
import { noteName, SECRET_MASK } from './NoteTile'

export const REVEAL_MS = 30_000

type Props = {
  note: LibraryItem
  onEdit: () => void
  onClose: () => void
}

// Reading view for an existing note. An ordinary note shows its body at once. A
// secret note stays masked until Reveal, hides again after 30 seconds, and hides
// the moment the document is hidden or this view closes. Editing a secret is its
// own explicit action. Copy belongs to the clipboard boundary and is not here.
export function NoteReader({ note, onEdit, onClose }: Props) {
  const [revealed, setRevealed] = useState(false)
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    if (!revealed) return
    const timer = setTimeout(() => {
      setRevealed(false)
      setExpired(true)
    }, REVEAL_MS)
    return () => clearTimeout(timer)
  }, [revealed])

  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        setRevealed(false)
        setExpired(false)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  function reveal() {
    setExpired(false)
    setRevealed(true)
  }

  function hide() {
    setRevealed(false)
    setExpired(false)
  }

  const body = note.body ?? ''
  return <div className="note-reader">
    <h3 className="note-reader-title">{noteName(note)}</h3>
    {note.isSecret
      ? revealed
        ? <pre className="note-body note-body-secret">{body}</pre>
        : <p className="note-body note-body-masked"><span aria-hidden="true">{SECRET_MASK}</span><span className="visually-hidden">Secret content is hidden.</span></p>
      : <div className="note-body">{body}</div>}
    <p role="status" className="note-reader-status">{expired ? 'Secret hidden.' : ''}</p>
    <div className="editor-actions">
      {note.isSecret && (revealed
        ? <button type="button" onClick={hide}>Hide</button>
        : <button type="button" onClick={reveal}>Reveal</button>)}
      <button className="primary-button" type="button" onClick={onEdit}>{note.isSecret ? 'Edit secret' : 'Edit'}</button>
      <button type="button" onClick={onClose}>Close</button>
    </div>
  </div>
}
