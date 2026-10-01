import { useId, useRef, useState, type FormEvent } from 'react'
import { Dialog } from '../../components/Dialog'
import { useLibrary } from '../library/LibraryProvider'
import { collectionPath } from '../library/hierarchy'
import { createCollection, updateCollection } from '../library/repository'
import type { CollectionColor, ItemId, LibraryItem } from '../library/types'
import { validateCollectionInput } from '../library/validation'

export type EditorResult = 'created' | 'saved' | 'unchanged' | 'closed'

export const COLOR_CHOICES: ReadonlyArray<{ color: CollectionColor, label: string }> = [
  { color: 'sage', label: 'Sage' },
  { color: 'clay', label: 'Clay' },
  { color: 'ochre', label: 'Ochre' },
  { color: 'slate', label: 'Slate' },
]

type Props =
  | { parentId: ItemId | null, collection?: undefined, onClose: (result: EditorResult) => void }
  | { collection: LibraryItem, parentId?: undefined, onClose: (result: EditorResult) => void }

// One editor for a new collection and for renaming or recoloring an existing one.
// An existing collection is saved against the version it had when the editor
// opened, so a change made elsewhere meanwhile is reported, never overwritten. After
// that report the retry uses the refreshed version, so it is the person's explicit choice.
export function CollectionEditor({ parentId, collection, onClose }: Props) {
  const library = useLibrary()
  const [title, setTitle] = useState(collection?.title ?? '')
  const [color, setColor] = useState<CollectionColor>(collection?.color ?? 'sage')
  const [failure, setFailure] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  // After a conflict the retry uses the live version from the refreshed snapshot.
  const retrying = useRef(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const errorId = useId()
  const items = library.snapshot?.items ?? []
  const live = collection ? items.find((candidate) => candidate.id === collection.id) : undefined
  const removed = collection !== undefined && library.snapshot !== null && !live
  const parent = collection ? collection.parentId : parentId
  const where = ['Scratch', ...collectionPath(items, parent).map((item) => item.title ?? '')].join(' / ')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy.current) return
    const input = { parentId: parent ?? null, title, color }
    const issues = validateCollectionInput(input)
    if (issues.length > 0) {
      setFailure(issues[0].message)
      titleRef.current?.focus()
      return
    }
    if (collection && collection.title === title && collection.color === color) {
      onClose('unchanged')
      return
    }
    busy.current = true
    setSaving(true)
    setFailure(null)
    const expectedVersion = collection && retrying.current && live ? live.version : collection?.version
    const result = await library.runMutation((session, context) => collection
      ? updateCollection(session, { ...context, expectedVersion }, collection.id, input)
      : createCollection(session, context, input))
    busy.current = false
    setSaving(false)
    if (result.ok) {
      onClose(collection ? 'saved' : 'created')
      return
    }
    setFailure(result.message)
    // A conflict means the library moved on; load it so a retry starts current.
    if (result.code === 'conflict') {
      retrying.current = true
      void library.refresh()
    }
    titleRef.current?.focus()
  }

  // The collection was removed in another tab: nothing is left to edit.
  if (removed) {
    return <Dialog title="Edit collection" className="organize-dialog" initialFocus="[data-autofocus]" onRequestClose={() => onClose('closed')} canClose={() => true}>
      <div className="organize-form">
        <p role="alert">This item no longer exists.</p>
        <div className="dialog-actions"><button data-autofocus="" type="button" onClick={() => onClose('closed')}>Close</button></div>
      </div>
    </Dialog>
  }

  return <Dialog
    title={collection ? 'Edit collection' : 'New collection'}
    className="organize-dialog"
    initialFocus="[data-autofocus]"
    onRequestClose={() => onClose('closed')}
    canClose={() => !busy.current}
  >
    <form className="organize-form" onSubmit={(event) => void submit(event)} noValidate>
      <p className="form-hint organize-where">{collection ? 'In' : 'Saving in'} {where}</p>
      <label htmlFor={titleId}>Title</label>
      <input
        id={titleId}
        ref={titleRef}
        data-autofocus=""
        type="text"
        value={title}
        readOnly={saving}
        autoComplete="off"
        aria-invalid={failure !== null || undefined}
        aria-describedby={failure ? errorId : undefined}
        onChange={(event) => { setTitle(event.target.value); setFailure(null) }}
      />
      <div role="group" aria-label="Color" className="color-choices">
        {COLOR_CHOICES.map((choice) => <button
          key={choice.color}
          type="button"
          className="color-choice"
          data-color={choice.color}
          aria-pressed={color === choice.color}
          disabled={saving}
          onClick={() => setColor(choice.color)}
        ><span className="color-swatch" aria-hidden="true" />{choice.label}</button>)}
      </div>
      <p role="status" className="form-hint organize-status">{saving ? 'Saving.' : ''}</p>
      {failure && <p id={errorId} role="alert" className="form-error">{failure}</p>}
      <div className="dialog-actions">
        <button className="primary-button" type="submit" disabled={saving}>Save</button>
        <button type="button" disabled={saving} onClick={() => onClose('closed')}>Cancel</button>
      </div>
    </form>
  </Dialog>
}
