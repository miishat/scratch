import { useMemo, useRef, useState } from 'react'
import { Dialog } from '../../components/Dialog'
import { useLibrary } from '../library/LibraryProvider'
import { moveDestinations } from '../library/hierarchy'
import { moveItem } from '../library/repository'
import type { ItemId, LibraryItem } from '../library/types'

export type MoveResult = { kind: 'moved', label: string } | { kind: 'unchanged' } | { kind: 'closed' }

const ROOT = 'root'

// Lists Scratch and every collection the item may legally move to. Choosing a
// destination only selects it; nothing is written until Move here. The item is
// moved against the version it had when the dialog opened; after a conflict the
// retry uses the refreshed version, and an item removed elsewhere ends the dialog.
export function MoveDialog({ item, onClose }: { item: LibraryItem, onClose: (result: MoveResult) => void }) {
  const library = useLibrary()
  const items = library.snapshot?.items
  const destinations = useMemo(() => (items ? moveDestinations(items, item.id) : []), [items, item.id])
  const [selected, setSelected] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  // After a conflict the retry uses the live version from the refreshed snapshot.
  const retrying = useRef(false)
  const live = items?.find((candidate) => candidate.id === item.id)

  async function move() {
    if (busy.current || selected === null) return
    const target = destinations.find((destination) => (destination.id ?? ROOT) === selected)
    if (!target) return
    const label = target.path.length > 0 ? target.path[target.path.length - 1] : 'Scratch'
    if (target.id === (live ?? item).parentId) {
      onClose({ kind: 'unchanged' })
      return
    }
    busy.current = true
    setSaving(true)
    setFailure(null)
    const expectedVersion = retrying.current && live ? live.version : item.version
    const result = await library.runMutation((session, context) => moveItem(session, { ...context, expectedVersion }, item.id, target.id))
    busy.current = false
    setSaving(false)
    if (result.ok) {
      onClose({ kind: 'moved', label })
      return
    }
    setFailure(result.message)
    if (result.code === 'conflict') retrying.current = true
    // A refusal because the item vanished arrives as a validation failure; reading
    // the library again shows that instead of leaving a dialog that cannot succeed.
    if (result.code === 'conflict' || result.code === 'validation') void library.refresh()
  }

  // The item was removed in another tab: nothing is left to move.
  if (items && !live) {
    return <Dialog title="Move" className="organize-dialog" initialFocus="[data-autofocus]" onRequestClose={() => onClose({ kind: 'closed' })} canClose={() => true}>
      <div className="organize-form">
        <p role="alert">This item no longer exists.</p>
        <div className="dialog-actions"><button data-autofocus="" type="button" onClick={() => onClose({ kind: 'closed' })}>Close</button></div>
      </div>
    </Dialog>
  }

  return <Dialog
    title="Move"
    className="organize-dialog"
    initialFocus='input[type="radio"]'
    onRequestClose={() => onClose({ kind: 'closed' })}
    canClose={() => !busy.current}
  >
    <div className="organize-form">
      <div role="radiogroup" aria-label="Destination" className="destination-list">
        {destinations.map((destination) => {
          const key: ItemId | typeof ROOT = destination.id ?? ROOT
          const name = destination.path.length > 0 ? destination.path.join(' / ') : 'Scratch'
          const current = destination.id === (live ?? item).parentId
          return <label key={key} className="destination" style={{ paddingInlineStart: `${12 + Math.max(0, destination.path.length - 1) * 16}px` }}>
            <input
              type="radio"
              name="destination"
              aria-label={name}
              checked={selected === key}
              disabled={saving}
              onChange={() => setSelected(key)}
            />
            <span>{destination.path.length > 0 ? destination.path[destination.path.length - 1] : 'Scratch'}</span>
            {current && <span className="form-hint">Current location</span>}
          </label>
        })}
      </div>
      {failure && <p role="alert" className="form-error">{failure}</p>}
      <div className="dialog-actions">
        <button className="primary-button" type="button" disabled={saving || selected === null} onClick={() => void move()}>Move here</button>
        <button type="button" disabled={saving} onClick={() => onClose({ kind: 'closed' })}>Cancel</button>
      </div>
    </div>
  </Dialog>
}
