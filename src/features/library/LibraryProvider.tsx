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

export function LibraryProvider({ session, children }: LibraryProviderProps): ReactNode {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null)
  const [status, setStatus] = useState<LibraryStatus>('locked')
  const [error, setError] = useState<string | null>(null)
  const [activeSession, setActiveSession] = useState<VaultSession | null>(null)
  const holds = useRef(0)
  const pendingRefresh = useRef(false)

  // Reset decrypted state during render whenever the session identity changes,
  // so a stale snapshot can never survive a lock or vault replacement.
  if (activeSession !== session) {
    setActiveSession(session)
    setSnapshot(null)
    setError(null)
    setStatus(session ? 'loading' : 'locked')
  }

  const clearUnlockedState = useCallback((): void => {
    setSnapshot(null)
    setStatus('locked')
    setError(null)
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    if (!session) return
    try {
      const result = await loadLibrary(session)
      if (result.ok) {
        setSnapshot(result.snapshot)
        setError(null)
        setStatus('ready')
        return
      }
      setSnapshot(null)
      setError(result.message)
      setStatus('error')
    } catch {
      setSnapshot(null)
      setError('Local storage is unavailable. Try again.')
      setStatus('error')
    }
  }, [session])

  useEffect(() => {
    if (!session) return
    let active = true
    void loadLibrary(session)
      .then((result) => {
        if (!active) return
        if (result.ok) {
          setSnapshot(result.snapshot)
          setError(null)
          setStatus('ready')
        } else {
          setSnapshot(null)
          setError(result.message)
          setStatus('error')
        }
      })
      .catch(() => {
        if (!active) return
        setSnapshot(null)
        setError('Local storage is unavailable. Try again.')
        setStatus('error')
      })

    const subscription = subscribeToChanges(() => {
      if (holds.current > 0) {
        pendingRefresh.current = true
        return
      }
      void refresh()
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [session, refresh])

  const holdRefresh = useCallback((): (() => void) => {
    holds.current += 1
    return () => {
      holds.current = Math.max(0, holds.current - 1)
      if (holds.current === 0 && pendingRefresh.current) {
        pendingRefresh.current = false
        void refresh()
      }
    }
  }, [refresh])

  const runMutation = useCallback(
    async (run: MutationRunner): Promise<MutationResult> => {
      if (!session || !snapshot) {
        return { ok: false, code: 'unavailable', message: 'This library is locked.' }
      }
      const context: MutationContext = {
        generation: snapshot.meta.generation,
        expectedRevision: snapshot.meta.revision,
      }
      const result = await run(session, context)
      if (result.ok) {
        setSnapshot(result.snapshot)
        setError(null)
        setStatus('ready')
      }
      return result
    },
    [session, snapshot],
  )

  const value = useMemo<LibraryContextValue>(
    () => ({ snapshot, status, error, refresh, runMutation, clearUnlockedState, holdRefresh }),
    [snapshot, status, error, refresh, runMutation, clearUnlockedState, holdRefresh],
  )

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>
}

export function useLibrary(): LibraryContextValue {
  const value = useContext(LibraryContext)
  if (!value) throw new Error('useLibrary must be used within a LibraryProvider.')
  return value
}
