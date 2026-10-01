import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Dialog } from '../../components/Dialog'
import { useLibrary } from '../library/LibraryProvider'
import type { ItemId, LibraryItem } from '../library/types'
import type { DraftContent } from '../vault/session'
import { NoteConflictPanel } from './NoteConflictPanel'
import { NoteReader } from './NoteReader'
import { useNoteDraft, type EditorOutcome } from './useNoteDraft'
import { useVisualViewport } from './useVisualViewport'

export interface NoteEditorProps {
  // Collection a new note is created in; an existing note keeps its own parent.
  parentId: ItemId | null
  note?: LibraryItem
  // An unsaved edit restored after an automatic lock.
  recovered?: DraftContent
  onRecoveredUsed?: () => void
  onClose: (outcome: EditorOutcome) => void
}

// One editor for new and existing notes. The outer component only exists so the
// inner one can be rebuilt: from the latest saved version after Load latest, or
// from a recovered draft that arrives after the note was already shown.
export function NoteEditor({ onRecoveredUsed, recovered, ...props }: NoteEditorProps) {
  const library = useLibrary()
  const [epoch, setEpoch] = useState(0)
  const [adopted, setAdopted] = useState<DraftContent | undefined>(recovered)
  if (recovered && recovered !== adopted) {
    setAdopted(recovered)
    setEpoch((value) => value + 1)
  }
  useEffect(() => {
    if (adopted) onRecoveredUsed?.()
  }, [adopted, onRecoveredUsed])
  return <EditorSurface
    key={epoch}
    {...props}
    recovered={adopted}
    onReload={async () => {
      setAdopted(undefined)
      await library.refresh()
      setEpoch((value) => value + 1)
    }}
  />
}

function EditorSurface({ parentId, note, recovered, onClose, onReload }: Omit<NoteEditorProps, 'onRecoveredUsed'> & { onReload: () => Promise<void> }) {
  const library = useLibrary()
  const [mode, setMode] = useState<'read' | 'edit'>(note && !recovered ? 'read' : 'edit')
  const [titleOpened, setTitleOpened] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const keepRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const bodyId = useId()
  const hintId = useId()
  const draft = useNoteDraft({ parentId, note, recovered, onClose, onResume: () => bodyRef.current?.focus() })
  useVisualViewport()

  const { values, confirm, conflict } = draft
  const showTitle = titleOpened || values.title !== '' || values.isSecret

  useEffect(() => {
    if (confirm) keepRef.current?.focus()
  }, [confirm])
  useEffect(() => {
    if (!conflict && mode === 'edit') bodyRef.current?.focus()
  }, [conflict, mode])

  async function submit() {
    const result = await draft.save()
    if (result.ok || result.code === 'conflict' || result.code === 'vault-changed') return
    // Keep the writing position available: the fields stay mounted, so focus
    // returns to the one the message is about.
    if (result.code === 'validation' && /title/i.test(result.message)) titleRef.current?.focus()
    else bodyRef.current?.focus()
  }

  function onKeyDown(event: KeyboardEvent) {
    // While an input method is composing, Enter and Escape belong to it.
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      if (event.key === 'Escape') event.stopPropagation()
      return
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && mode === 'edit') {
      event.preventDefault()
      void submit()
    }
  }

  function cancel() {
    if (draft.requestLeave()) onClose('closed')
  }

  const title = mode === 'read' ? 'Note' : note ? 'Edit note' : 'New note'
  const reviewing = conflict !== null
  const remoteNotice = library.remoteChangePending && draft.dirty && !reviewing

  return <Dialog
    title={title}
    className="editor-dialog"
    initialFocus="[data-autofocus]"
    onRequestClose={() => onClose('closed')}
    canClose={draft.requestLeave}
  >
    {mode === 'read' && note
      ? <NoteReader note={note} onEdit={() => setMode('edit')} onClose={() => onClose('closed')} />
      : <div className="editor-body" onKeyDown={onKeyDown}>
        {conflict && <NoteConflictPanel
          kind={conflict}
          noteId={note?.id ?? null}
          draft={values}
          message={draft.failure?.message ?? null}
          busy={draft.saving}
          onKeepEditing={draft.closeConflict}
          onLoadLatest={() => { draft.release(); void onReload() }}
          onSaveAsNew={() => void draft.saveAsNew()}
        />}
        <div className="editor-fields" hidden={reviewing}>
          {remoteNotice && <div className="editor-notice" role="status">
            <p>Another tab changed this library. Your draft is unchanged.</p>
            {draft.isEdit && <button type="button" onClick={() => draft.openConflict('conflict')}>Review latest</button>}
          </div>}
          {showTitle
            ? <div className="editor-title">
              <label htmlFor={titleId}>Title</label>
              <input
                id={titleId}
                ref={titleRef}
                type="text"
                value={values.title}
                readOnly={draft.saving}
                autoComplete="off"
                onChange={(event) => draft.setTitle(event.target.value)}
              />
            </div>
            : <button className="editor-add-title" type="button" onClick={() => {
              setTitleOpened(true)
              requestAnimationFrame(() => titleRef.current?.focus())
            }}>Add title</button>}
          <label className="visually-hidden" htmlFor={bodyId}>Note body</label>
          <textarea
            id={bodyId}
            ref={bodyRef}
            data-autofocus=""
            className="editor-textarea"
            value={values.body}
            readOnly={draft.saving}
            spellCheck={!values.isSecret}
            autoComplete="off"
            onChange={(event) => draft.setBody(event.target.value)}
          />
          <div className="editor-secret">
            <label>
              <input
                type="checkbox"
                checked={values.isSecret}
                disabled={draft.saving}
                aria-describedby={hintId}
                onChange={(event) => draft.setSecret(event.target.checked)}
              /> Secret note
            </label>
            <p id={hintId} className="form-hint">Masked until you reveal it. A secret note needs a title.</p>
          </div>
          <p role="status" className="form-hint editor-saving">{draft.saving ? 'Saving your note.' : ''}</p>
          {draft.failure && !reviewing && <p role="alert" className="form-error">{draft.failure.message}</p>}
        </div>
        {(confirm || !reviewing) && (confirm
          ? <div className="editor-actions" role="group" aria-label="Unsaved changes">
            <p>You have unsaved changes.</p>
            <button ref={keepRef} className="primary-button" type="button" onClick={() => draft.answerConfirm(false)}>Keep editing</button>
            <button type="button" onClick={() => draft.answerConfirm(true)}>Discard</button>
          </div>
          : <div className="editor-actions">
            <button className="primary-button" type="button" disabled={draft.saving} onClick={() => void submit()}>Save</button>
            <button type="button" disabled={draft.saving} onClick={cancel}>Cancel</button>
          </div>)}
      </div>}
  </Dialog>
}
