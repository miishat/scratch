import { NavLink } from '../../components/NavLink'
import { DotsIcon, FolderIcon } from '../../components/TileIcons'
import type { LibraryItem } from '../library/types'

export function itemCountLabel(count: number): string {
  return count === 1 ? '1 item' : `${count} items`
}

type Props = { collection: LibraryItem, childCount: number, onMenu?: (item: LibraryItem) => void }

// The tile's main area is a link to the collection id. The overflow control is a
// sibling, never nested inside the link.
export function CollectionTile({ collection, childCount, onMenu }: Props) {
  const title = collection.title ?? ''
  const count = itemCountLabel(childCount)
  return <li className="tile collection-tile" data-color={collection.color ?? 'sage'}>
    <NavLink className="tile-link" route={{ collectionId: collection.id }} aria-label={`${title}, ${count}`}>
      <FolderIcon />
      <span className="tile-title">{title}</span>
      <span className="tile-meta">{count}</span>
    </NavLink>
    {onMenu && <div className="tile-actions">
      <button className="icon-button" type="button" aria-label={`More actions for ${title}`} onClick={() => onMenu(collection)}><DotsIcon /></button>
    </div>}
  </li>
}
