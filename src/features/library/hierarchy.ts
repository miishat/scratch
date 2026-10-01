import type { ItemId, LibraryItem } from './types'
import { APP_LIMITS } from './types'

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
