import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LibraryItem } from '../library/types'
import { buildSearchIndex, searchItems, type SearchHit } from './search'

export const SEARCH_DEBOUNCE_MS = 150

export interface SearchState {
  query: string
  setQuery: (value: string) => void
  clear: () => void
  // Null while no settled query is active; otherwise the matches, possibly none.
  results: SearchHit[] | null
  // A count only. Never contains the query or any note text.
  announcement: string
}

// All search state is React state owned by the unlocked shell: the query, the
// debounce timer, the index, and the results. Nothing is stored, sent, or put
// in the URL, and it all disappears when the shell unmounts on lock. The index
// exists only while a query is active and is always rebuilt from the items
// passed in, which are the latest validated committed snapshot, so an edit
// that makes a note secret takes effect in the same render. A missing library
// or a route change discards the query.
export function useSearch(items: LibraryItem[] | undefined, routeKey: string): SearchState {
  const [query, setQueryState] = useState('')
  const [settled, setSettled] = useState('')
  const [lastRoute, setLastRoute] = useState(routeKey)

  if (lastRoute !== routeKey) {
    setLastRoute(routeKey)
    if (query !== '' || settled !== '') {
      setQueryState('')
      setSettled('')
    }
  }
  if (!items && (query !== '' || settled !== '')) {
    setQueryState('')
    setSettled('')
  }

  useEffect(() => {
    if (query.trim() === '') return
    const timer = setTimeout(() => setSettled(query), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  const setQuery = useCallback((value: string) => {
    setQueryState(value)
    if (value.trim() === '') setSettled('')
  }, [])
  const clear = useCallback(() => {
    setQueryState('')
    setSettled('')
  }, [])

  const active = query.trim() !== '' && settled.trim() !== ''
  const index = useMemo(() => (items && active ? buildSearchIndex(items) : null), [items, active])
  const results = useMemo(() => (index ? searchItems(index, settled) : null), [index, settled])

  let announcement = ''
  if (results) announcement = results.length === 0 ? 'No matches' : results.length === 1 ? '1 result' : `${results.length} results`
  return { query, setQuery, clear, results, announcement }
}
