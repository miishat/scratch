import { useEffect, useState } from 'react'
import { loadLibrary } from '../library/repository'
import type { ItemId, LibraryItem } from '../library/types'
import { useVault } from '../vault/VaultProvider'
import { SECRET_MASK } from './NoteTile'
import type { ConflictKind, NoteDraftValues } from './useNoteDraft'

type Latest =
  | { state: 'loading' }
  | { state: 'note', note: LibraryItem }
  | { state: 'deleted' }
  | { state: 'replaced', message: string }
  | { state: 'error', message: string }

type Props = {
  kind: ConflictKind
  noteId: ItemId | null
  draft: NoteDraftValues
  message: string | null
  busy: boolean
  onKeepEditing: () => void
  // Discards the draft and shows the latest saved version.
  onLoadLatest: () => void
  onSaveAsNew: () => void
}

function Version({ label, title, body, secret }: { label: string, title: string, body: string, secret: boolean }) {
  return <section className="conflict-version" aria-label={label}>
    <h4>{label}</h4>
    {title !== '' && <p className="conflict-title">{title}</p>}
    {secret
      ? <p className="note-body note-body-masked"><span aria-hidden="true">{SECRET_MASK}</span><span className="visually-hidden">Secret content is hidden.</span></p>
      : <div className="note-body">{body}</div>}
  </section>
}

// Shown when the note changed elsewhere, or the library was replaced. It never
// writes: Latest and Your draft sit side by side and the person picks what
// happens next. Secret content stays masked in both versions.
export function NoteConflictPanel({ kind, noteId, draft, message, busy, onKeepEditing, onLoadLatest, onSaveAsNew }: Props) {
  const { session, discardDraftAndReload } = useVault()
  const [latest, setLatest] = useState<Latest>(kind === 'replaced' ? { state: 'replaced', message: message ?? '' } : { state: 'loading' })
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (kind === 'replaced' || !session || noteId === null) return
    let current = true
    loadLibrary(session).then((result) => {
      if (!current) return
      if (!result.ok) {
        setLatest(result.code === 'vault-changed' ? { state: 'replaced', message: result.message } : { state: 'error', message: result.message })
        return
      }
      const found = noteId ? result.snapshot.items.find((item) => item.id === noteId && item.kind === 'note') : undefined
      setLatest(found ? { state: 'note', note: found } : { state: 'deleted' })
    }).catch(() => {
      if (current) setLatest({ state: 'error', message: 'Local storage is unavailable. Try again.' })
    })
    return () => { current = false }
  }, [kind, session, noteId])

  if (noteId === null && latest.state !== 'replaced') {
    return <section className="note-conflict" aria-label="Library changed">
      <h3>The library changed in another tab</h3>
      <p>Your draft is unchanged and nothing was overwritten.</p>
      <Version label="Your draft" title={draft.title} body={draft.body} secret={draft.isSecret} />
      {message && <p role="alert" className="form-error">{message}</p>}
      <div className="editor-actions">
        <button className="primary-button" type="button" onClick={onKeepEditing}>Keep editing</button>
        <button type="button" disabled={busy} onClick={onSaveAsNew}>Try saving again</button>
      </div>
    </section>
  }

  if (latest.state === 'replaced') {
    return <section className="note-conflict" aria-label="Library replaced">
      <h3>This library was replaced</h3>
      <p>{latest.message || 'This library was replaced. Unlock the current library to continue.'}</p>
      <p>Your draft was not saved and has not been written anywhere.</p>
      <div className="editor-actions">
        <button className="primary-button" type="button" onClick={onKeepEditing}>Keep editing</button>
        <button type="button" onClick={discardDraftAndReload}>Discard draft and reload</button>
      </div>
    </section>
  }

  const secretLatest = latest.state === 'note' && latest.note.isSecret
  return <section className="note-conflict" aria-labelledby="note-conflict-title">
    <h3 id="note-conflict-title">This note changed elsewhere</h3>
    <p>Nothing was overwritten. Compare the two versions, then choose.</p>
    <div className="conflict-versions">
      {latest.state === 'loading' && <p role="status">Loading the latest version.</p>}
      {latest.state === 'error' && <p role="alert">{latest.message}</p>}
      {latest.state === 'deleted' && <section className="conflict-version" aria-label="Latest"><h4>Latest</h4><p>This note was deleted in another tab.</p></section>}
      {latest.state === 'note' && <Version label="Latest" title={latest.note.title ?? ''} body={latest.note.body ?? ''} secret={secretLatest} />}
      <Version label="Your draft" title={draft.title} body={draft.body} secret={draft.isSecret || secretLatest} />
    </div>
    {message && <p role="alert" className="form-error">{message}</p>}
    {confirming
      ? <div className="editor-actions" role="group" aria-label="Confirm load latest">
        <p>Load the latest version and discard your draft?</p>
        <button className="primary-button" type="button" onClick={onLoadLatest}>Discard draft and load latest</button>
        <button type="button" onClick={() => setConfirming(false)}>Keep editing</button>
      </div>
      : <div className="editor-actions">
        <button className="primary-button" type="button" onClick={onKeepEditing}>Keep editing</button>
        {latest.state === 'note' && <button type="button" onClick={() => setConfirming(true)}>Load latest</button>}
        <button type="button" disabled={busy || latest.state === 'loading'} onClick={onSaveAsNew}>Save as new note</button>
      </div>}
  </section>
}
