import { useMemo } from 'react'
import { TileGrid } from '../../components/TileGrid'
import { CollectionTile } from '../collections/CollectionTile'
import type { CopyResult } from '../clipboard/copy'
import type { ItemId, LibraryItem } from '../library/types'
import { NoteTile } from '../notes/NoteTile'
import type { SearchHit } from './search'

type Props = {
  results: SearchHit[]
  items: LibraryItem[]
  onCopyNote?: (note: LibraryItem) => Promise<CopyResult | void> | void
}

// Results reuse the collection and note tiles, so opening one goes through the
// same guarded navigation as the grid. Each tile also names where it lives.
export function SearchResults({ results, items, onCopyNote }: Props) {
  const { byId, counts } = useMemo(() => {
    const byId = new Map<ItemId, LibraryItem>()
    const counts = new Map<ItemId, number>()
    for (const item of items) {
      byId.set(item.id, item)
      if (item.parentId !== null) counts.set(item.parentId, (counts.get(item.parentId) ?? 0) + 1)
    }
    return { byId, counts }
  }, [items])

  if (results.length === 0) {
    return <section className="empty-state" aria-label="Search results"><p>No matches</p></section>
  }
  return <TileGrid label="Search results">
    {results.map((hit) => {
      const item = byId.get(hit.id)
      if (!item) return null
      return item.kind === 'collection'
        ? <CollectionTile key={item.id} collection={item} childCount={counts.get(item.id) ?? 0} path={hit.parentPath} />
        : <NoteTile key={item.id} note={item} onCopy={onCopyNote} path={hit.parentPath} />
    })}
  </TileGrid>
}
