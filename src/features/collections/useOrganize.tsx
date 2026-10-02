import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ItemId, LibraryItem } from '../library/types'
import { CollectionEditor, type EditorResult } from './CollectionEditor'
import { DeleteDialog, type DeleteResult } from './DeleteDialog'
import { ItemMenu, type ItemAction } from './ItemMenu'
import { MoveDialog, type MoveResult } from './MoveDialog'

type Active =
  | { kind: 'menu', item: LibraryItem }
  | { kind: 'create', parentId: ItemId | null }
  | { kind: 'edit' | 'move' | 'delete', item: LibraryItem }

// Owns the organization dialogs: create, edit, move, delete, and the overflow
// menu that leads to them. Each dialog works from the item as it was when it
// opened, so a change made elsewhere is a conflict rather than a silent overwrite.
export function useOrganize(announce: (message: string) => void) {
  const [active, setActive] = useState<Active | null>(null)
  // Set when the control that had focus may be gone after a close.
  const repair = useRef<'add' | 'lost' | null>(null)

  // Runs after the closing dialog has returned focus. A tile that no longer
  // exists cannot take it back, so focus goes to a control that is still there.
  useEffect(() => {
    const mode = repair.current
    if (!mode || active) return
    repair.current = null
    const current = document.activeElement
    const lost = !current || current === document.body || !document.body.contains(current)
    if (mode === 'add' || lost) {
      const tile = mode === 'lost' ? document.querySelector<HTMLElement>('.tile-link') : null
      ;(tile ?? document.querySelector<HTMLElement>(mode === 'add' ? '.header-add-collection' : '.header-add-note'))?.focus()
    }
  })

  const openCreate = useCallback((parentId: ItemId | null) => setActive({ kind: 'create', parentId }), [])
  const openMenu = useCallback((item: LibraryItem) => setActive({ kind: 'menu', item }), [])
  const close = useCallback(() => setActive(null), [])

  function choose(item: LibraryItem, action: ItemAction) {
    setActive({ kind: action, item })
  }

  function finishEditor(result: EditorResult) {
    if (result === 'created') { announce('Collection created'); repair.current = 'add' }
    if (result === 'saved') { announce('Saved'); repair.current = 'lost' }
    setActive(null)
  }

  function finishMove(result: MoveResult) {
    if (result.kind === 'moved') { announce(`Moved to ${result.label}`); repair.current = 'lost' }
    if (result.kind === 'unchanged') announce('Already there. Nothing changed.')
    setActive(null)
  }

  function finishDelete(result: DeleteResult) {
    if (result === 'deleted') { announce('Deleted'); repair.current = 'lost' }
    setActive(null)
  }

  let dialogs: ReactNode = null
  if (active?.kind === 'menu') dialogs = <ItemMenu item={active.item} onChoose={(action) => choose(active.item, action)} onClose={close} />
  else if (active?.kind === 'create') dialogs = <CollectionEditor parentId={active.parentId} onClose={finishEditor} />
  else if (active?.kind === 'edit') dialogs = <CollectionEditor collection={active.item} onClose={finishEditor} />
  else if (active?.kind === 'move') dialogs = <MoveDialog item={active.item} onClose={finishMove} />
  else if (active?.kind === 'delete') dialogs = <DeleteDialog item={active.item} onClose={finishDelete} />

  return { openCreate, openMenu, dialogs }
}
