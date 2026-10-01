import { useRef, useState } from 'react'
import { Dialog } from '../../components/Dialog'
import { useLibrary } from '../library/LibraryProvider'
import { descendantsOf } from '../library/hierarchy'
import { deleteItem } from '../library/repository'
import type { LibraryItem } from '../library/types'
import { noteName } from '../notes/NoteTile'
import { itemCountLabel } from './CollectionTile'

export type DeleteResult = 'deleted' | 'closed'

// Permanent deletion needs a confirmation of what will actually go. The count
// always comes from the committed snapshot. If the library changes while the
// dialog is open, the confirmation is withdrawn until the person has reviewed
// the updated count, and the repository separately refuses a stale delete.
export function DeleteDialog({ item, onClose }: { item: LibraryItem, onClose: (result: DeleteResult) => void }) {
  const library = useLibrary()
  const snapshot = library.snapshot
  const isCollection = item.kind === 'collection'
  const descendants = snapshot && isCollection ? descendantsOf(snapshot.items, item.id) : []
  const count = descendants.length
  // Identifies exactly what a deletion would remove, so a change elsewhere in the
  // library does not reopen the question but a change inside this subtree does.
  const contents = [...descendants].sort().join(',')
  // The contents the person has seen and may confirm; null once a delete conflicted.
  const [reviewed, setReviewed] = useState<string | null>(contents)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)

  const live = snapshot?.items.find((candidate) => candidate.id === item.id)
  const stale = reviewed !== contents
  const heading = isCollection ? 'Delete collection' : 'Delete note'

  async function confirm() {
    if (busy.current || stale) return
    busy.current = true
    setSaving(true)
    setNotice(null)
    const result = await library.runMutation((session, context) => deleteItem(session, { ...context, expectedVersion: item.version }, item.id))
    busy.current = false
    setSaving(false)
    if (result.ok) {
      onClose('deleted')
      return
    }
    setNotice(result.message)
    if (result.code === 'conflict') {
      // Nothing was deleted. Withdraw the confirmation and load what changed.
      setReviewed(null)
      await library.refresh()
    }
  }

  function review() {
    setNotice(null)
    setReviewed(contents)
  }

  let body: string
  if (!isCollection) body = item.isSecret ? 'This permanently deletes this secret note. This cannot be undone.' : `This permanently deletes ${noteName(item)}. This cannot be undone.`
  else if (count === 0) body = `${item.title ?? 'This collection'} is empty. It will be deleted permanently, and this cannot be undone.`
  else body = `This permanently deletes ${item.title ?? 'this collection'} and the ${itemCountLabel(count)} inside it. This cannot be undone.`

  return <Dialog
    title={heading}
    className="organize-dialog"
    initialFocus="[data-autofocus]"
    onRequestClose={() => onClose('closed')}
    canClose={() => !busy.current}
  >
    <div className="organize-form">
      {live
        ? <>
          <p>{body}</p>
          {stale && !notice && <p role="alert" className="form-error">This collection changed after you opened this dialog. Review the updated count before deleting.</p>}
          {notice && <p role="alert" className="form-error">{notice}</p>}
          <div className="dialog-actions">
            {stale
              ? <button className="primary-button" type="button" onClick={review}>Review updated count</button>
              : <button className="danger-button" type="button" disabled={saving} onClick={() => void confirm()}>Delete permanently</button>}
            <button data-autofocus="" type="button" disabled={saving} onClick={() => onClose('closed')}>Cancel</button>
          </div>
        </>
        : <>
          <p role="alert">This item no longer exists.</p>
          <div className="dialog-actions"><button data-autofocus="" type="button" onClick={() => onClose('closed')}>Close</button></div>
        </>}
    </div>
  </Dialog>
}
