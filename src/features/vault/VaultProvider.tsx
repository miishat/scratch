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
import { Dialog } from '../../components/Dialog'
import { initializeLibrary, readHeader, changePassphrase as storeHeader } from '../library/repository'
import { subscribeToChanges } from '../library/changes'
import { validatePassphrase } from '../library/validation'
import { StorageUnavailableScreen } from '../support/SupportScreens'
import { createVault, openEnvelope, rewrapVault, sealEnvelope, unlockVault } from './crypto'
import {
  decodeDraft,
  encodeDraft,
  hiddenElapsed,
  HIDDEN_LOCK_MS,
  inactivityElapsed,
  INACTIVITY_LOCK_MS,
  sameVault,
  type ActionResult,
  type DirtyDraft,
  type DraftContent,
  type SealedDraft,
  type VaultState,
} from './session'
import type { VaultSession } from './types'

// The vault session lives only in React state and refs. Nothing here writes a key,
// passphrase, or decrypted draft to storage, and passphrases are never retained
// after a call returns. Locking is current-tab only.

export interface LockPromptState {
  saving: boolean
}

export interface VaultContextValue {
  state: VaultState
  session: VaultSession | null
  // True from the moment the tab is hidden (or a lock begins) until it is safe to
  // show decrypted content again. Consumers hide decrypted UI while it is set.
  concealed: boolean
  error: string | null
  notice: string | null
  // A draft sealed before an automatic lock and reopened after unlocking the same
  // vault and generation. The editor consumes it and then calls clearRecoveredDraft.
  recoveredDraft: DraftContent | null
  clearRecoveredDraft: () => void
  hasDirtyDraft: boolean
  // Set when another tab replaced the vault or its header while a draft is dirty.
  remoteReplacement: boolean
  lockPrompt: LockPromptState | null
  lockErrorMessage: string | null
  create: (passphrase: string) => Promise<ActionResult>
  unlock: (passphrase: string) => Promise<ActionResult>
  requestLock: () => void
  automaticLock: () => Promise<void>
  changePassphrase: (current: string, next: string) => Promise<ActionResult>
  registerDraft: (draft: DirtyDraft) => () => void
  readDraft: () => DraftContent | null
  saveAndLock: () => Promise<void>
  discardAndLock: () => void
  cancelLock: () => void
  discardDraftAndReload: () => void
}

const VaultContext = createContext<VaultContextValue | null>(null)

type Boot = 'checking' | 'ready' | 'unavailable'

const LOCKED_AUTOMATICALLY = 'Scratch locked automatically.'
const CHANGED_ELSEWHERE = 'This library changed in another tab. Unlock again.'

export function VaultProvider({ children }: { children: ReactNode }): ReactNode {
  const [boot, setBoot] = useState<Boot>('checking')
  const [state, setStateValue] = useState<VaultState>('locked')
  const [session, setSession] = useState<VaultSession | null>(null)
  const [concealed, setConcealed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [recoveredDraft, setRecoveredDraft] = useState<DraftContent | null>(null)
  const [hasDirtyDraft, setHasDirtyDraft] = useState(false)
  const [remoteReplacement, setRemoteReplacement] = useState(false)
  const [lockPrompt, setLockPrompt] = useState<LockPromptState | null>(null)
  const [lockErrorMessage, setLockErrorMessage] = useState<string | null>(null)
  const [lockNotice, setLockNotice] = useState<string | null>(null)

  const stateRef = useRef<VaultState>('locked')
  const sessionRef = useRef<VaultSession | null>(null)
  const draftRef = useRef<DirtyDraft | null>(null)
  const sealedRef = useRef<SealedDraft | null>(null)
  const lastActivity = useRef(0)
  const hiddenAt = useRef<number | null>(null)
  const locking = useRef(false)
  // Bumped whenever the session ends or an unlock begins, so a slow unlock or
  // header check can never act after the situation it started in has changed.
  const epoch = useRef(0)

  const setState = useCallback((next: VaultState): void => {
    stateRef.current = next
    setStateValue(next)
  }, [])

  const checkStorage = useCallback(async (): Promise<void> => {
    setBoot('checking')
    const stored = await readHeader()
    if (!stored.ok) {
      setBoot('unavailable')
      return
    }
    setState(stored.library === 'absent' ? 'setup' : 'locked')
    setBoot('ready')
  }, [setState])

  useEffect(() => {
    // Reading the header is the external system this effect synchronizes with.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void checkStorage()
  }, [checkStorage])

  // Ends the in-memory session. Dropping the session identity makes the library
  // provider discard its decrypted snapshot; the data key reference is released.
  const releaseSession = useCallback(
    (message: string | null): void => {
      epoch.current += 1
      sessionRef.current = null
      draftRef.current = null
      hiddenAt.current = null
      setSession(null)
      setHasDirtyDraft(false)
      setConcealed(false)
      setLockPrompt(null)
      setLockErrorMessage(null)
      setLockNotice(null)
      setRemoteReplacement(false)
      setRecoveredDraft(null)
      setError(null)
      setNotice(message)
      setState('locked')
    },
    [setState],
  )

  const startSession = useCallback(
    (next: VaultSession, recovered: DraftContent | null): void => {
      sessionRef.current = next
      lastActivity.current = Date.now()
      setSession(next)
      setRecoveredDraft(recovered)
      setConcealed(false)
      setError(null)
      setNotice(null)
      setState('unlocked')
    },
    [setState],
  )

  const create = useCallback(
    async (passphrase: string): Promise<ActionResult> => {
      const issues = validatePassphrase(passphrase)
      if (issues.length > 0) return { ok: false, message: issues[0].message }
      try {
        const created = await createVault(passphrase)
        const init = await initializeLibrary(created)
        if (!init.ok) {
          if (init.code === 'conflict') {
            setNotice('A library already exists in this browser. Unlock it to continue.')
            setState('locked')
          }
          return { ok: false, message: init.message }
        }
        startSession(init.session, null)
        return { ok: true }
      } catch {
        return { ok: false, message: 'Could not create the vault. Try again.' }
      }
    },
    [setState, startSession],
  )

  const unlock = useCallback(
    async (passphrase: string): Promise<ActionResult> => {
      if (stateRef.current !== 'locked') return { ok: false }
      epoch.current += 1
      const mine = epoch.current
      setState('unlocking')
      setError(null)
      setNotice(null)
      const fail = (message: string): ActionResult => {
        if (epoch.current === mine) {
          setError(message)
          setState('locked')
        }
        return { ok: false, message }
      }
      // The header is read fresh so a passphrase changed in another tab applies.
      const stored = await readHeader()
      if (epoch.current !== mine) return { ok: false }
      if (!stored.ok) return fail(stored.message)
      if (stored.library === 'absent') {
        setState('setup')
        return { ok: false }
      }
      const result = await unlockVault(stored.header.header, passphrase, stored.header.meta.generation)
      if (epoch.current !== mine) return { ok: false }
      if (!result.ok) return fail(result.message)

      let recovered: DraftContent | null = null
      const sealed = sealedRef.current
      if (sealed) {
        if (sealed.vaultId === result.session.header.vaultId && sealed.generation === result.session.generation) {
          const opened = await openEnvelope(result.session, 'draft', sealed.envelope)
          if (epoch.current !== mine) return { ok: false }
          if (opened.ok) recovered = decodeDraft(opened.plaintext)
        }
        sealedRef.current = null
      }
      startSession(result.session, recovered)
      return { ok: true }
    },
    [setState, startSession],
  )

  const registerDraft = useCallback((draft: DirtyDraft): (() => void) => {
    draftRef.current = draft
    setHasDirtyDraft(true)
    return () => {
      if (draftRef.current !== draft) return
      draftRef.current = null
      setHasDirtyDraft(false)
    }
  }, [])

  const readDraft = useCallback((): DraftContent | null => draftRef.current?.read() ?? null, [])
  const clearRecoveredDraft = useCallback((): void => setRecoveredDraft(null), [])

  const automaticLock = useCallback(async (): Promise<void> => {
    const current = sessionRef.current
    if (!current || stateRef.current !== 'unlocked' || locking.current) return
    locking.current = true
    // Conceal first: nothing decrypted may stay visible while sealing runs.
    setConcealed(true)
    setLockPrompt(null)
    try {
      const draft = draftRef.current
      if (draft) {
        const bytes = encodeDraft(draft.read())
        try {
          const envelope = await sealEnvelope(current, 'draft', bytes)
          sealedRef.current = {
            vaultId: current.header.vaultId,
            generation: current.generation,
            envelope,
          }
        } catch {
          if (sessionRef.current !== current) return
          // Sealing failed: the draft is still only in the editor. Do not report
          // Locked; keep the editor concealed and offer explicit recovery.
          setLockErrorMessage('Scratch could not protect your unsaved note, so it is not locked.')
          setState('lock-error')
          return
        } finally {
          bytes.fill(0)
        }
      }
      if (sessionRef.current !== current) return
      releaseSession(LOCKED_AUTOMATICALLY)
    } finally {
      locking.current = false
    }
  }, [releaseSession, setState])

  const requestLock = useCallback((): void => {
    if (stateRef.current !== 'unlocked') return
    setLockNotice(null)
    if (!draftRef.current) {
      releaseSession(null)
      return
    }
    setLockPrompt({ saving: false })
  }, [releaseSession])

  const saveDraft = useCallback(async (): Promise<string | null> => {
    const draft = draftRef.current
    if (!draft) return null
    try {
      const result = await draft.save()
      return result.ok ? null : result.message
    } catch {
      return 'Could not save your note.'
    }
  }, [])

  const saveAndLock = useCallback(async (): Promise<void> => {
    const current = sessionRef.current
    if (stateRef.current === 'lock-error') {
      const failure = await saveDraft()
      if (sessionRef.current !== current) return
      if (failure === null) releaseSession(null)
      else setLockErrorMessage(`Could not save: ${failure}`)
      return
    }
    setLockPrompt({ saving: true })
    const failure = await saveDraft()
    if (sessionRef.current !== current) return
    if (failure === null) {
      releaseSession(null)
      return
    }
    // The editor stays open and editable; the lock did not happen.
    setLockPrompt(null)
    setLockNotice(`Not locked. Your note was not saved: ${failure}`)
  }, [releaseSession, saveDraft])

  const discardAndLock = useCallback((): void => {
    draftRef.current?.discard()
    releaseSession(null)
  }, [releaseSession])

  const cancelLock = useCallback((): void => {
    draftRef.current?.cancel()
    setLockPrompt(null)
  }, [])

  const discardDraftAndReload = useCallback((): void => {
    draftRef.current?.discard()
    releaseSession(CHANGED_ELSEWHERE)
  }, [releaseSession])

  const changePassphrase = useCallback(async (current: string, next: string): Promise<ActionResult> => {
    const active = sessionRef.current
    if (!active || stateRef.current !== 'unlocked') return { ok: false, message: 'Scratch is locked.' }
    const issues = validatePassphrase(next)
    if (issues.length > 0) return { ok: false, message: issues[0].message }
    let header
    try {
      header = await rewrapVault(active, current, next)
    } catch {
      return { ok: false, message: 'The current passphrase is incorrect.' }
    }
    const stored = await readHeader()
    if (!stored.ok) return { ok: false, message: stored.message }
    if (stored.library === 'absent' || !sameVault(active, stored.header)) {
      return { ok: false, message: 'This library changed in another tab. Lock and unlock to continue.' }
    }
    const result = await storeHeader(
      active,
      { generation: stored.header.meta.generation, expectedRevision: stored.header.meta.revision },
      header,
    )
    if (!result.ok) return { ok: false, message: result.message }
    if (sessionRef.current !== active) return { ok: false }
    const updated: VaultSession = { ...active, header: result.snapshot.header }
    sessionRef.current = updated
    setSession(updated)
    return { ok: true }
  }, [])

  // Inactivity and visibility deadlines apply only while unlocked.
  useEffect(() => {
    if (state !== 'unlocked') return
    let inactivityTimer: ReturnType<typeof setTimeout> | undefined
    let hiddenTimer: ReturnType<typeof setTimeout> | undefined

    function schedule(): void {
      clearTimeout(inactivityTimer)
      const remaining = lastActivity.current + INACTIVITY_LOCK_MS - Date.now()
      inactivityTimer = setTimeout(checkInactivity, Math.max(0, remaining))
    }
    function checkInactivity(): void {
      if (inactivityElapsed(lastActivity.current, Date.now())) {
        void automaticLock()
        return
      }
      schedule()
    }
    const onActivity = (): void => {
      lastActivity.current = Date.now()
    }
    const onVisibility = (): void => {
      const now = Date.now()
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = now
        setConcealed(true)
        clearTimeout(hiddenTimer)
        hiddenTimer = setTimeout(() => void automaticLock(), HIDDEN_LOCK_MS)
        return
      }
      clearTimeout(hiddenTimer)
      const since = hiddenAt.current
      hiddenAt.current = null
      if ((since !== null && hiddenElapsed(since, now)) || inactivityElapsed(lastActivity.current, now)) {
        // Stay concealed: the lock completes before any plaintext is shown again.
        void automaticLock()
        return
      }
      setConcealed(false)
      schedule()
    }
    const onFocus = (): void => {
      if (inactivityElapsed(lastActivity.current, Date.now())) void automaticLock()
    }

    const activityEvents = ['keydown', 'pointerdown', 'pointermove', 'touchstart'] as const
    for (const name of activityEvents) document.addEventListener(name, onActivity, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    schedule()
    return () => {
      clearTimeout(inactivityTimer)
      clearTimeout(hiddenTimer)
      for (const name of activityEvents) document.removeEventListener(name, onActivity)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
    }
  }, [state, automaticLock])

  // Another tab replaced the vault, or changed its header (passphrase change).
  // Item-only changes leave the header intact and are handled by the library.
  useEffect(() => {
    if (state !== 'unlocked') return
    let latest = 0
    const subscription = subscribeToChanges(() => {
      const active = sessionRef.current
      if (!active) return
      latest += 1
      const mine = latest
      void readHeader().then((stored) => {
        if (mine !== latest || sessionRef.current !== active || !stored.ok) return
        if (stored.library === 'present' && sameVault(active, stored.header)) return
        if (draftRef.current) setRemoteReplacement(true)
        else releaseSession(CHANGED_ELSEWHERE)
      })
    })
    return () => {
      latest += 1
      subscription.unsubscribe()
    }
  }, [state, releaseSession])

  const value = useMemo<VaultContextValue>(
    () => ({
      state,
      session,
      concealed,
      error,
      notice,
      recoveredDraft,
      clearRecoveredDraft,
      hasDirtyDraft,
      remoteReplacement,
      lockPrompt,
      lockErrorMessage,
      create,
      unlock,
      requestLock,
      automaticLock,
      changePassphrase,
      registerDraft,
      readDraft,
      saveAndLock,
      discardAndLock,
      cancelLock,
      discardDraftAndReload,
    }),
    [
      state, session, concealed, error, notice, recoveredDraft, clearRecoveredDraft, hasDirtyDraft,
      remoteReplacement, lockPrompt, lockErrorMessage, create, unlock, requestLock, automaticLock,
      changePassphrase, registerDraft, readDraft, saveAndLock, discardAndLock, cancelLock, discardDraftAndReload,
    ],
  )

  if (boot === 'unavailable') return <StorageUnavailableScreen onRetry={() => void checkStorage()} />
  if (boot === 'checking') return <p className="support-screen" role="status">Opening Scratch</p>

  return (
    <VaultContext.Provider value={value}>
      {children}
      {lockPrompt && (
        <Dialog title="Lock Scratch?" onRequestClose={cancelLock} canClose={() => !lockPrompt.saving}>
          <p>You have an unsaved note. Choose what happens to it before Scratch locks.</p>
          <div className="dialog-actions">
            <button className="primary-button" type="button" disabled={lockPrompt.saving} onClick={() => void saveAndLock()}>Save and lock</button>
            <button type="button" disabled={lockPrompt.saving} onClick={discardAndLock}>Discard and lock</button>
            <button type="button" disabled={lockPrompt.saving} onClick={cancelLock}>Cancel</button>
          </div>
        </Dialog>
      )}
      {lockNotice && <div className="toast-region" role="alert">{lockNotice}</div>}
    </VaultContext.Provider>
  )
}

export function useVault(): VaultContextValue {
  const value = useContext(VaultContext)
  if (!value) throw new Error('useVault must be used within a VaultProvider.')
  return value
}
