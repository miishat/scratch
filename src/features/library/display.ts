import type { LibraryItem } from './types'
import { countGraphemes } from './validation'

// Derived labels and stable ordering for display. A secret note never derives a
// title from its body; the title is always explicit.

export const MAX_DERIVED_TITLE_GRAPHEMES = 60

export function firstNonblankLine(body: string): string | null {
  for (const line of body.split(/\r\n|\n|\r/)) {
    if (line.trim() !== '') return line
  }
  return null
}

export function truncateGraphemes(text: string, max: number): string {
  if (countGraphemes(text) <= max) return text
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  let count = 0
  let result = ''
  for (const segment of segmenter.segment(text)) {
    if (count >= max) break
    result += segment.segment
    count++
  }
  return result
}

// The first nonblank line of a body, truncated to 60 grapheme clusters.
export function deriveNoteTitle(body: string): string | null {
  const line = firstNonblankLine(body)
  if (line === null) return null
  return truncateGraphemes(line, MAX_DERIVED_TITLE_GRAPHEMES)
}

// The title shown for an item. Collections and secret notes always have an
// explicit title; an ordinary note without one derives its title from the body.
export function displayTitle(item: LibraryItem): string | null {
  if (item.title !== null) return item.title
  if (item.kind === 'note' && !item.isSecret) return deriveNoteTitle(item.body ?? '')
  return null
}

// Collections first, then createdAt ascending, then id ascending.
export function compareItems(a: LibraryItem, b: LibraryItem): number {
  if (a.kind !== b.kind) return a.kind === 'collection' ? -1 : 1
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
  if (a.id !== b.id) return a.id < b.id ? -1 : 1
  return 0
}

export function sortItems(items: LibraryItem[]): LibraryItem[] {
  return [...items].sort(compareItems)
}

// Where an item lives, for search results: its collection titles from the top.
export function pathLabel(path: string[]): string {
  return `In ${path.length ? path.join(' / ') : 'Scratch'}`
}
