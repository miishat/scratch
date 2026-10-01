import { displayTitle, compareItems } from '../library/display'
import { collectionPath } from '../library/hierarchy'
import type { ItemId, ItemKind, LibraryItem } from '../library/types'

// An ephemeral, in-memory index. It is built from a validated committed
// snapshot, held only in React state while unlocked, and never persisted or
// sent anywhere. A secret note contributes its title and nothing else, so no
// secret body exists in the index to be matched or leaked.

export interface SearchEntry {
  id: ItemId
  kind: ItemKind
  parentId: ItemId | null
  displayTitle: string
  parentPath: string[]
  // Normalized text that queries are matched against.
  text: string
}

export interface SearchHit {
  id: ItemId
  kind: ItemKind
  parentId: ItemId | null
  displayTitle: string
  parentPath: string[]
}

export function normalizeForSearch(value: string): string {
  return value.normalize('NFC').toLowerCase()
}

function titleOf(item: LibraryItem): string {
  if (item.kind === 'collection') return item.title ?? ''
  return displayTitle(item) ?? (item.isSecret ? 'Untitled secret note' : 'Untitled note')
}

export function buildSearchIndex(items: LibraryItem[]): SearchEntry[] {
  const paths = new Map<ItemId | null, string[]>()
  function pathFor(parentId: ItemId | null): string[] {
    let path = paths.get(parentId)
    if (!path) {
      path = collectionPath(items, parentId).map((collection) => collection.title ?? '')
      paths.set(parentId, path)
    }
    return path
  }
  return [...items].sort(compareItems).map((item) => {
    const title = titleOf(item)
    const searchable = item.kind === 'note' && !item.isSecret ? `${item.title ?? ''}\n${item.body ?? ''}` : item.title ?? ''
    return {
      id: item.id,
      kind: item.kind,
      parentId: item.parentId,
      displayTitle: title,
      parentPath: pathFor(item.parentId),
      text: normalizeForSearch(searchable),
    }
  })
}

// Every whitespace separated word must appear. An empty query matches nothing.
export function searchItems(index: SearchEntry[], query: string): SearchHit[] {
  const words = normalizeForSearch(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const hits: SearchHit[] = []
  for (const entry of index) {
    if (words.every((word) => entry.text.includes(word))) {
      hits.push({ id: entry.id, kind: entry.kind, parentId: entry.parentId, displayTitle: entry.displayTitle, parentPath: entry.parentPath })
    }
  }
  return hits
}
