import { Dialog } from '../../components/Dialog'
import { noteName } from '../notes/NoteTile'
import type { LibraryItem } from '../library/types'

export type ItemAction = 'edit' | 'move' | 'delete'

// The overflow menu of a tile or collection heading. It is a small dialog so it
// works the same with touch and keyboard, holds focus, and returns it to the
// control that opened it.
export function ItemMenu({ item, onChoose, onClose }: { item: LibraryItem, onChoose: (action: ItemAction) => void, onClose: () => void }) {
  const name = item.kind === 'collection' ? item.title ?? '' : noteName(item)
  return <Dialog title={`Actions for ${name}`} className="organize-dialog" initialFocus=".item-menu button" onRequestClose={onClose} canClose={() => true}>
    <div className="item-menu">
      {item.kind === 'collection' && <button type="button" onClick={() => onChoose('edit')}>Edit</button>}
      <button type="button" onClick={() => onChoose('move')}>Move</button>
      <button type="button" onClick={() => onChoose('delete')}>Delete</button>
    </div>
  </Dialog>
}
