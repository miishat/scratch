import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ItemId, LibraryItem } from '../features/library/types'
import {
  formatRoute,
  HOME_ROUTE,
  INVALID_ROUTE_MESSAGE,
  isSameRoute,
  knownParentMap,
  parseHash,
  resolveRoute,
  type AppRoute,
  type ParsedHash,
} from './navigation'
import { NavigationContext, type NavigationValue, type NavigationGuard } from './useNavigation'

interface HistoryMark { scratchIdx: number }

function readIndex(state: unknown): number | null {
  const value = (state as Partial<HistoryMark> | null)?.scratchIdx
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

export function NavigationProvider({ items, children }: { items: LibraryItem[] | null, children: ReactNode }): ReactNode {
  const [raw, setRaw] = useState<ParsedHash>(() => parseHash(window.location.hash))
  const guards = useRef(new Set<NavigationGuard>())
  const index = useRef(readIndex(window.history.state) ?? 0)
  // Set when the provider itself undoes a refused traversal, so the popstate that
  // undoing causes is not treated as a new navigation.
  // The index the provider expects to land on after undoing a refused traversal.
  const suppressPop = useRef<{ landing: number, timer: ReturnType<typeof setTimeout> } | null>(null)
  // Parent links remembered from earlier snapshots, so a deleted collection can
  // still be walked up. Holds ids only.
  const [known, setKnown] = useState(() => new Map<ItemId, ItemId | null>())
  // Ids this tab deleted on purpose; falling back from them needs no notice.
  const [deleted, setDeleted] = useState<ReadonlySet<ItemId>>(() => new Set())
  const [seenItems, setSeenItems] = useState<LibraryItem[] | null>(null)
  if (items && items !== seenItems) {
    setSeenItems(items)
    setKnown(knownParentMap(items, known))
  }

  const requested = raw.valid ? raw.route : HOME_ROUTE
  const resolved = useMemo(
    () => (items ? resolveRoute(requested, items, known) : { route: requested, message: null }),
    [items, requested, known],
  )
  const route = resolved.route
  const deliberate = (requested.collectionId !== null && deleted.has(requested.collectionId))
    || (requested.noteId !== undefined && deleted.has(requested.noteId))
  const message = !raw.valid ? INVALID_ROUTE_MESSAGE : deliberate ? null : resolved.message
  const routeRef = useRef(route)

  // Make the address bar match what is shown, without adding a history entry.
  useEffect(() => {
    routeRef.current = route
    const wanted = formatRoute(route)
    const current = window.location.hash === '' ? '#/' : window.location.hash
    if (current !== wanted || readIndex(window.history.state) === null) {
      const mark: HistoryMark = { scratchIdx: index.current }
      window.history.replaceState(mark, '', current !== wanted ? wanted : undefined)
    }
  }, [route])

  const runGuards = useCallback(async (): Promise<boolean> => {
    for (const guard of [...guards.current]) {
      if (!(await guard())) return false
    }
    return true
  }, [])

  const navigate = useCallback(async (target: AppRoute): Promise<boolean> => {
    if (isSameRoute(target, routeRef.current)) return true
    if (!(await runGuards())) return false
    index.current += 1
    const mark: HistoryMark = { scratchIdx: index.current }
    window.history.pushState(mark, '', formatRoute(target))
    setRaw({ valid: true, route: target })
    return true
  }, [runGuards])

  useEffect(() => {
    async function onPop(event: PopStateEvent) {
      const target = readIndex(event.state)
      const pending = suppressPop.current
      if (pending) {
        // Only the undo traversal is swallowed. Anything else is a real event,
        // even if the undo never happened.
        clearTimeout(pending.timer)
        suppressPop.current = null
        if (target === pending.landing) return
      }
      if (guards.current.size > 0 && !(await runGuards())) {
        const landing = index.current
        suppressPop.current = { landing, timer: setTimeout(() => { suppressPop.current = null }, 1000) }
        // Undo the traversal. An entry we did not create (a typed hash) has no
        // index; stepping back returns to the entry we were on.
        if (target === null) window.history.back()
        else window.history.go(index.current - target)
        return
      }
      index.current = target ?? index.current + 1
      setRaw(parseHash(window.location.hash))
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (suppressPop.current) clearTimeout(suppressPop.current.timer)
      suppressPop.current = null
    }
  }, [runGuards])

  const registerGuard = useCallback((guard: NavigationGuard): (() => void) => {
    guards.current.add(guard)
    return () => { guards.current.delete(guard) }
  }, [])

  const parentOfCurrent = useMemo(() => {
    if (route.collectionId === null) return null
    return items?.find((item) => item.id === route.collectionId)?.parentId ?? null
  }, [items, route.collectionId])

  const navigateBack = useCallback((): void => {
    if (index.current > 0) window.history.back()
    else void navigate(route.noteId ? { collectionId: route.collectionId } : { collectionId: parentOfCurrent })
  }, [navigate, parentOfCurrent, route.noteId, route.collectionId])

  const acknowledgeDeletion = useCallback((ids: ItemId[]): void => {
    setDeleted((current) => new Set([...current, ...ids]))
  }, [])

  const value = useMemo<NavigationValue>(() => ({
    route,
    message,
    navigate,
    openCollection: (id) => navigate({ collectionId: id }),
    openNote: (parentId, noteId) => navigate({ collectionId: parentId, noteId }),
    closeNote: () => navigate({ collectionId: route.collectionId }),
    navigateBack,
    registerGuard,
    acknowledgeDeletion,
  }), [route, message, navigate, navigateBack, registerGuard, acknowledgeDeletion])

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>
}
