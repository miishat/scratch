import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { LibrarySnapshot, MutationContext, MutationResult } from './types'
import type { VaultSession } from '../vault/types'
import { loadLibrary } from './repository'
import { subscribeToChanges } from './changes'

// The provider owns the decrypted snapshot only while a session is present. It
// never persists plaintext: the snapshot lives in React state and is dropped
// when the session is cleared. Callers run every mutation through runMutation so
// a single place updates the snapshot on committed success and keeps failures
// from looking like success.

export type MutationRunner = (session: VaultSession, context: MutationContext) => Promise<MutationResult>

export type LibraryStatus = 'locked' | 'loading' | 'ready' | 'error'

export interface LibraryContextValue {
  snapshot: LibrarySnapshot | null
  status: LibraryStatus
  error: string | null
  // True when a remote change arrived while refresh was held. The snapshot is
  // left untouched so a dirty editor can offer a conflict/refresh choice.
  remoteChangePending: boolean
  refresh: () => Promise<void>
  runMutation: (run: MutationRunner) => Promise<MutationResult>
  clearUnlockedState: () => void
  // Hold automatic remote refreshes while an editor is dirty. Releasing a hold
  // applies any change that arrived while it was held.
  holdRefresh: () => () => void
}

const LibraryContext = createContext<LibraryContextValue | null>(null)

export interface LibraryProviderProps {
  session: VaultSession | null
  children: ReactNode
}

// The same key in the same library. A rewrapped header (a passphrase change) gives a
// new session object but not a new library, so decrypted state and held refreshes
// carry on.
function sameLibrarySession(a: VaultSession | null, b: VaultSession | null): boolean {
  return a !== null && b !== null && a.dataKey === b.dataKey && a.generation === b.generation && a.header.vaultId === b.header.vaultId
}

export function LibraryProvider({ session: incoming, children }: LibraryProviderProps): ReactNode {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null)
  const [status, setStatus] = useState<LibraryStatus>('locked')
  const [error, setError] = useState<string | null>(null)
  const [activeSession, setActiveSession] = useState<VaultSession | null>(null)
  const session = sameLibrarySession(activeSession, incoming) ? activeSession : incoming
  const [remoteChangePending, setRemoteChangePending] = useState(false)
  const holds = useRef(0)
  const pendingRefresh = useRef(false)
  // Bumped whenever the session ends or the unlocked state is cleared. Async work
  // captures the value at start and drops its result if it has moved on, so a
  // pending load or mutation can never put a decrypted snapshot back after lock.
  const epoch = useRef(0)
  // Set by clearUnlockedState while the session is still live; only a new session
  // resets it, so remote changes cannot restore a snapshot after an explicit clear.
  // Contract: a caller that clears must follow it with a real lock (session null),
  // because this tab will not reload the library again for the same session.
  const cleared = useRef(false)

  // Reset decrypted state during render whenever the session identity changes,
  // so a stale snapshot can never survive a lock or vault replacement.
  if (activeSession !== session) {
    setActiveSession(session)
    setSnapshot(null)
    setError(null)
    setRemoteChangePending(false)
    setStatus(session ? 'loading' : 'locked')
  }

  const clearUnlockedState = useCallback((): void => {
    epoch.current += 1
    cleared.current = true
    holds.current = 0
    pendingRefresh.current = false
    setSnapshot(null)
    setStatus('locked')
    setError(null)
    setRemoteChangePending(false)
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    if (!session || cleared.current) return
    const started = epoch.current
    pendingRefresh.current = false
    let next: { snapshot: LibrarySnapshot | null; error: string | null }
    try {
      const result = await loadLibrary(session)
      next = result.ok
        ? { snapshot: result.snapshot, error: null }
        : { snapshot: null, error: result.message }
    } catch {
      next = { snapshot: null, error: 'Local storage is unavailable. Try again.' }
    }
    if (epoch.current !== started) return
    setSnapshot(next.snapshot)
    setError(next.error)
    setStatus(next.error === null ? 'ready' : 'error')
    setRemoteChangePending(false)
  }, [session])

  useEffect(() => {
    if (!session) return
    cleared.current = false
    void refresh()

    const subscription = subscribeToChanges(() => {
      if (cleared.current) return
      if (holds.current > 0) {
        pendingRefresh.current = true
        setRemoteChangePending(true)
        return
      }
      void refresh()
    })

    return () => {
      epoch.current += 1
      holds.current = 0
      pendingRefresh.current = false
      subscription.unsubscribe()
    }
  }, [session, refresh])

  const holdRefresh = useCallback((): (() => void) => {
    holds.current += 1
    const heldIn = epoch.current
    return () => {
      // A release that outlives its session must not touch the new state.
      if (epoch.current !== heldIn) return
      holds.current = Math.max(0, holds.current - 1)
      if (holds.current === 0 && pendingRefresh.current) {
        void refresh()
      }
    }
  }, [refresh])

  const runMutation = useCallback(
    async (run: MutationRunner): Promise<MutationResult> => {
      if (!session || !snapshot) {
        return { ok: false, code: 'unavailable', message: 'This library is locked.' }
      }
      const started = epoch.current
      const context: MutationContext = {
        generation: snapshot.meta.generation,
        expectedRevision: snapshot.meta.revision,
      }
      const result = await run(session, context)
      if (result.ok && epoch.current === started) {
        setSnapshot(result.snapshot)
        setError(null)
        setStatus('ready')
      }
      return result
    },
    [session, snapshot],
  )

  const value = useMemo<LibraryContextValue>(
    () => ({ snapshot, status, error, remoteChangePending, refresh, runMutation, clearUnlockedState, holdRefresh }),
    [snapshot, status, error, remoteChangePending, refresh, runMutation, clearUnlockedState, holdRefresh],
  )

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>
}

export function useLibrary(): LibraryContextValue {
  const value = useContext(LibraryContext)
  if (!value) throw new Error('useLibrary must be used within a LibraryProvider.')
  return value
}
