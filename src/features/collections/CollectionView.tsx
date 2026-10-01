import { useMemo, type ReactNode } from 'react'
import { useNavigation } from '../../app/useNavigation'
import { EmptyState } from '../../components/EmptyState'
import { TileGrid } from '../../components/TileGrid'
import { sortItems } from '../library/display'
import { DotsIcon } from '../../components/TileIcons'
import { collectionPath } from '../library/hierarchy'
import type { CopyResult } from '../clipboard/copy'
import type { ItemId, LibraryItem } from '../library/types'
import { NoteTile } from '../notes/NoteTile'
import { Breadcrumbs } from './Breadcrumbs'
import { CollectionTile } from './CollectionTile'

export interface CollectionViewProps {
  items: LibraryItem[]
  // Creation entry points; Tasks 6 and 7 supply them. The argument is the
  // collection being viewed, or null at the top level.
  onAddNote?: (parentId: ItemId | null) => void
  onAddCollection?: (parentId: ItemId | null) => void
  onCopyNote?: (note: LibraryItem) => Promise<CopyResult | void> | void
  onItemMenu?: (item: LibraryItem) => void
  // Editor for an open note route; the grid is shown when it is absent.
  renderNote?: (note: LibraryItem) => ReactNode
}

export function CollectionView({ items, onAddNote, onAddCollection, onCopyNote, onItemMenu, renderNote }: CollectionViewProps) {
  const { route, message } = useNavigation()
  const parentId = route.collectionId

  const { children, counts } = useMemo(() => {
    const counts = new Map<ItemId, number>()
    const direct: LibraryItem[] = []
    for (const item of items) {
      if (item.parentId !== null) counts.set(item.parentId, (counts.get(item.parentId) ?? 0) + 1)
      if (item.parentId === parentId) direct.push(item)
    }
    return { children: sortItems(direct), counts }
  }, [items, parentId])
  const path = useMemo(() => collectionPath(items, parentId), [items, parentId])
  const current = path[path.length - 1]
  const note = route.noteId ? items.find((item) => item.id === route.noteId) : undefined

  let body: ReactNode
  if (note && renderNote) {
    body = renderNote(note)
  } else if (children.length === 0) {
    body = parentId === null
      ? <EmptyState onAddNote={onAddNote && (() => onAddNote(null))} onAddCollection={onAddCollection && (() => onAddCollection(null))} />
      : <section className="empty-state" aria-label="Empty collection">
        <p>This collection is empty.</p>
        <div className="empty-actions">
          {onAddNote && <button className="primary-button" type="button" onClick={() => onAddNote(parentId)}>Add note</button>}
          {onAddCollection && <button type="button" onClick={() => onAddCollection(parentId)}>Add collection</button>}
        </div>
      </section>
  } else {
    body = <TileGrid label={current ? `Items in ${current.title}` : 'Items in Scratch'}>
      {children.map((item) => item.kind === 'collection'
        ? <CollectionTile key={item.id} collection={item} childCount={counts.get(item.id) ?? 0} onMenu={onItemMenu} />
        : <NoteTile key={item.id} note={item} onCopy={onCopyNote} onMenu={onItemMenu} />)}
    </TileGrid>
  }

  return <div className="collection-view">
    <p className="route-notice" role="status">{message}</p>
    {current
      ? <>
        <Breadcrumbs path={path} />
        <div className="collection-heading-row">
          <h1 className="collection-heading">{current.title}</h1>
          {onItemMenu && <button className="icon-button" type="button" aria-label={`More actions for ${current.title}`} onClick={() => onItemMenu(current)}><DotsIcon /></button>}
        </div>
      </>
      : children.length > 0 && <h1 className="visually-hidden">Scratch</h1>}
    {body}
  </div>
}
