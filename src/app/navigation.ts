import type { ItemId, LibraryItem } from '../features/library/types'

// Hash routing carries identifiers only. No title, body, or search term may ever
// appear in the URL, so parsing is strict and anything unexpected is malformed.

export interface AppRoute {
  collectionId: ItemId | null
  noteId?: ItemId
}

export interface ParsedHash {
  route: AppRoute
  // False when the hash was not a route this app produces.
  valid: boolean
}

export interface ResolvedRoute {
  route: AppRoute
  message: string | null
}

export const HOME_ROUTE: AppRoute = { collectionId: null }
export const INVALID_ROUTE_MESSAGE = 'That link could not be opened. Showing your home view.'
export const MISSING_COLLECTION_MESSAGE = 'That collection is no longer available.'
export const MISSING_NOTE_MESSAGE = 'That note is no longer available.'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ROOT_SEGMENT = 'root'

function asId(segment: string | undefined): ItemId | null {
  if (segment === undefined) return null
  const lower = segment.toLowerCase()
  return UUID.test(lower) ? lower : null
}

export function isSameRoute(a: AppRoute, b: AppRoute): boolean {
  return a.collectionId === b.collectionId && (a.noteId ?? null) === (b.noteId ?? null)
}

export function formatRoute(route: AppRoute): string {
  if (route.noteId) return `#/c/${route.collectionId ?? ROOT_SEGMENT}/n/${route.noteId}`
  return route.collectionId ? `#/c/${route.collectionId}` : '#/'
}

export function parseHash(hash: string): ParsedHash {
  const invalid: ParsedHash = { valid: false, route: HOME_ROUTE }
  if (hash === '' || hash === '#' || hash === '#/') return { valid: true, route: HOME_ROUTE }
  if (!hash.startsWith('#/')) return invalid
  const parts = hash.slice(2).split('/')
  if (parts[0] !== 'c') return invalid
  if (parts.length === 2) {
    const collectionId = asId(parts[1])
    return collectionId ? { valid: true, route: { collectionId } } : invalid
  }
  if (parts.length === 4 && parts[2] === 'n') {
    const collectionId = parts[1] === ROOT_SEGMENT ? null : asId(parts[1])
    const noteId = asId(parts[3])
    if (noteId && (collectionId !== null || parts[1] === ROOT_SEGMENT)) return { valid: true, route: { collectionId, noteId } }
  }
  return invalid
}

// Maps each collection id to its parent id so a deleted collection can still be
// walked up to the nearest ancestor that survives.
export function knownParentMap(items: LibraryItem[], previous?: Map<ItemId, ItemId | null>): Map<ItemId, ItemId | null> {
  const next = new Map(previous)
  for (const item of items) if (item.kind === 'collection') next.set(item.id, item.parentId)
  return next
}

// Checks a route against the current library. Decrypted text is never involved:
// the message names no item.
export function resolveRoute(route: AppRoute, items: LibraryItem[], knownParents?: Map<ItemId, ItemId | null>): ResolvedRoute {
  const byId = new Map(items.map((item) => [item.id, item]))
  const exists = (id: ItemId) => byId.get(id)?.kind === 'collection'

  const requested = route.collectionId
  if (requested !== null && !exists(requested)) {
    let found: ItemId | null = null
    let cursor: ItemId | null | undefined = knownParents?.get(requested)
    const seen = new Set<ItemId>([requested])
    while (cursor && !seen.has(cursor)) {
      if (exists(cursor)) { found = cursor; break }
      seen.add(cursor)
      cursor = knownParents?.get(cursor)
    }
    return { route: { collectionId: found }, message: MISSING_COLLECTION_MESSAGE }
  }
  if (route.noteId) {
    const note = byId.get(route.noteId)
    if (note?.kind === 'note' && note.parentId === requested) return { route: { collectionId: requested, noteId: route.noteId }, message: null }
    return { route: { collectionId: requested }, message: MISSING_NOTE_MESSAGE }
  }
  return { route: { collectionId: requested }, message: null }
}
