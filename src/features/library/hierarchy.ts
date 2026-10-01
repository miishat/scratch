import type { ItemId, LibraryItem } from './types'
import { APP_LIMITS } from './types'
import { sortItems } from './display'

// Tree operations over a decrypted item list. Depth is 0-based: a root
// collection (parentId null) sits at depth 0, and at most eight levels are
// allowed, so the deepest valid collection has depth 7.

export type TreeErrorCode =
  | 'duplicate-id'
  | 'missing-parent'
  | 'note-parent'
  | 'cycle'
  | 'excessive-depth'

export interface TreeError {
  code: TreeErrorCode
  id: ItemId
  parentId?: ItemId | null
  depth?: number
}

function indexById(items: LibraryItem[]): Map<ItemId, LibraryItem> {
  const byId = new Map<ItemId, LibraryItem>()
  for (const item of items) byId.set(item.id, item)
  return byId
}

// Number of collection ancestors of the item whose parent is parentId.
export function collectionDepth(items: LibraryItem[], parentId: ItemId | null): number {
  const byId = indexById(items)
  let depth = 0
  let cursor = parentId
  const seen = new Set<ItemId>()
  while (cursor !== null) {
    if (seen.has(cursor)) break // cycle guard
    seen.add(cursor)
    const parent = byId.get(cursor)
    if (!parent) break
    depth += 1
    cursor = parent.parentId
  }
  return depth
}

// All descendant ids of the item with the given id, excluding the item itself.
// A visited set guards against cycles introduced by direct database tampering.
export function descendantsOf(items: LibraryItem[], id: ItemId): ItemId[] {
  const childrenByParent = new Map<ItemId, ItemId[]>()
  for (const item of items) {
    if (item.parentId === null) continue
    const list = childrenByParent.get(item.parentId) ?? []
    list.push(item.id)
    childrenByParent.set(item.parentId, list)
  }
  const result: ItemId[] = []
  const visited = new Set<ItemId>([id])
  const stack = [...(childrenByParent.get(id) ?? [])]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (visited.has(current)) continue
    visited.add(current)
    result.push(current)
    stack.push(...(childrenByParent.get(current) ?? []))
  }
  return result
}

function isInCycle(byId: Map<ItemId, LibraryItem>, startId: ItemId): boolean {
  const seen = new Set<ItemId>()
  let cursor: ItemId | null = startId
  while (cursor !== null) {
    if (seen.has(cursor)) return true
    seen.add(cursor)
    const node = byId.get(cursor)
    if (!node) return false
    cursor = node.parentId
  }
  return false
}

export function validateTree(items: LibraryItem[]): TreeError[] {
  const errors: TreeError[] = []
  const byId = new Map<ItemId, LibraryItem>()
  for (const item of items) {
    if (byId.has(item.id)) {
      errors.push({ code: 'duplicate-id', id: item.id })
    } else {
      byId.set(item.id, item)
    }
  }

  for (const item of items) {
    if (item.parentId !== null && !byId.has(item.parentId)) {
      errors.push({ code: 'missing-parent', id: item.id, parentId: item.parentId })
    } else if (item.parentId !== null) {
      const parent = byId.get(item.parentId)!
      if (parent.kind !== 'collection') {
        errors.push({ code: 'note-parent', id: item.id, parentId: item.parentId })
      }
    }

    if (item.kind === 'collection') {
      const depth = collectionDepth(items, item.parentId)
      if (depth >= APP_LIMITS.maxCollectionDepth) {
        errors.push({ code: 'excessive-depth', id: item.id, depth })
      }
    }
  }

  for (const item of items) {
    if (isInCycle(byId, item.id)) {
      errors.push({ code: 'cycle', id: item.id })
    }
  }

  return errors
}

// The collections from the top level down to the collection with the given id,
// inclusive. Empty when the id is null or unknown. Cycle-guarded.
export function collectionPath(items: LibraryItem[], id: ItemId | null): LibraryItem[] {
  const byId = indexById(items)
  const path: LibraryItem[] = []
  const seen = new Set<ItemId>()
  let cursor = id
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor)
    const node = byId.get(cursor)
    if (!node || node.kind !== 'collection') break
    path.unshift(node)
    cursor = node.parentId
  }
  return path
}

// Levels of collections in the subtree rooted at id, counting the root itself:
// a collection with no sub-collections has height 1. Cycle-guarded.
export function subtreeHeight(items: LibraryItem[], id: ItemId): number {
  const childCollections = new Map<ItemId, ItemId[]>()
  for (const item of items) {
    if (item.kind !== 'collection' || item.parentId === null) continue
    const list = childCollections.get(item.parentId) ?? []
    list.push(item.id)
    childCollections.set(item.parentId, list)
  }
  let height = 1
  const visited = new Set<ItemId>([id])
  const stack: Array<[ItemId, number]> = [[id, 1]]
  while (stack.length > 0) {
    const [current, level] = stack.pop()!
    height = Math.max(height, level)
    for (const child of childCollections.get(current) ?? []) {
      if (visited.has(child)) continue
      visited.add(child)
      stack.push([child, level + 1])
    }
  }
  return height
}

export interface MoveDestination {
  // Null is the top level, Scratch.
  id: ItemId | null
  // Titles from the top level down; empty for Scratch itself.
  path: string[]
}

// Where the item may be moved: Scratch plus every collection that is not the
// item or one of its descendants and that keeps a moved collection's whole
// subtree within the depth limit. The repository enforces the same rules, so
// this only decides what is worth offering. Depth-first, siblings in display order.
export function moveDestinations(items: LibraryItem[], itemId: ItemId): MoveDestination[] {
  const item = items.find((candidate) => candidate.id === itemId)
  if (!item) return []
  const excluded = new Set<ItemId>([itemId, ...descendantsOf(items, itemId)])
  const height = item.kind === 'collection' ? subtreeHeight(items, itemId) : 0
  const childrenOf = new Map<ItemId | null, LibraryItem[]>()
  for (const candidate of items) {
    if (candidate.kind !== 'collection') continue
    const list = childrenOf.get(candidate.parentId) ?? []
    list.push(candidate)
    childrenOf.set(candidate.parentId, list)
  }
  const result: MoveDestination[] = [{ id: null, path: [] }]
  const visited = new Set<ItemId>()
  // `level` is the 1-based level of the collections being listed. A moved
  // collection would sit one level below its destination and its deepest
  // descendant `height` levels below that, which must stay within the limit.
  function walk(parentId: ItemId | null, path: string[], level: number): void {
    for (const collection of sortItems(childrenOf.get(parentId) ?? [])) {
      if (excluded.has(collection.id) || visited.has(collection.id)) continue
      visited.add(collection.id)
      const here = [...path, collection.title ?? '']
      if (height === 0 || level + height <= APP_LIMITS.maxCollectionDepth) result.push({ id: collection.id, path: here })
      walk(collection.id, here, level + 1)
    }
  }
  walk(null, [], 1)
  return result
}
