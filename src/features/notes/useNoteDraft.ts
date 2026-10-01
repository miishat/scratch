import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigation } from '../../app/useNavigation'
import { useLibrary } from '../library/LibraryProvider'
import { createNote, loadLibrary, updateNote } from '../library/repository'
import { validateNoteInput } from '../library/validation'
import type { ItemId, LibraryItem, MutationContext, MutationFailureCode, MutationResult, NoteInput } from '../library/types'
import type { DraftContent } from '../vault/session'
import type { VaultSession } from '../vault/types'
import { useVault } from '../vault/VaultProvider'

// How an editor ended. Saved and saved-new report committed writes; navigated
// means the person discarded the draft to follow an in-app navigation that is
// already under way.
export type EditorOutcome = 'saved' | 'saved-new' | 'closed' | 'navigated'

export interface NoteDraftValues {
  title: string
  body: string
  isSecret: boolean
}

// The reason a save could not go ahead on the current draft. Only a conflict or
// a replaced library calls for the recovery panel; other failures are shown as
// a plain safe message and leave the draft as it was.
export interface SaveFailure {
  code: MutationFailureCode
  message: string
}

export type ConflictKind = 'conflict' | 'replaced'

export type Confirmation = 'leave' | 'navigate' | null

interface Options {
  parentId: ItemId | null
  note?: LibraryItem
  recovered?: DraftContent
  onClose: (outcome: EditorOutcome) => void
  // Called when the vault gives the person back their editor after a lock
  // prompt was cancelled.
  onResume: () => void
}

const EMPTY: NoteDraftValues = { title: '', body: '', isSecret: false }
const UNAVAILABLE = 'Could not save your note. Try again.'

function fromNote(note: LibraryItem): NoteDraftValues {
  return { title: note.title ?? '', body: note.body ?? '', isSecret: note.isSecret }
}

function fromBase(base: { title: string, body: string, isSecret: boolean }): NoteDraftValues {
  return { title: base.title, body: base.body, isSecret: base.isSecret }
}

// A recovered edit is only trusted when the note is still exactly what the
// draft started from. Anything else, including a draft with no recorded
// baseline, goes to the conflict panel instead of being rebased.
function recoveredConflicts(note: LibraryItem | undefined, recovered: DraftContent | undefined): boolean {
  if (!note || !recovered) return false
  const base = recovered.base
  return !base || base.version !== note.version || !sameValues(fromBase(base), fromNote(note))
}

function fromInput(input: NoteInput): NoteDraftValues {
  return { title: input.title ?? '', body: input.body, isSecret: input.isSecret }
}

function sameValues(a: NoteDraftValues, b: NoteDraftValues): boolean {
  return a.title === b.title && a.body === b.body && a.isSecret === b.isSecret
}

function toInput(values: NoteDraftValues, parentId: ItemId | null): NoteInput {
  return { parentId, title: values.title.trim() === '' ? null : values.title, body: values.body, isSecret: values.isSecret }
}

// Owns one editing session of one note: the draft, the single save path, the
// dirty-state registrations with the vault and navigation, and the leave
// confirmation. Draft state lives in this hook so it is independent of the
// library snapshot; a refreshed snapshot never touches it.
export function useNoteDraft({ parentId, note, recovered, onClose, onResume }: Options) {
  const library = useLibrary()
  const vault = useVault()
  const navigation = useNavigation()
  const { registerDraft, session } = vault
  const { registerGuard } = navigation

  // The identity and version the draft started from; later snapshots never
  // change what a save is checked against.
  const [base] = useState(() => (note ? { id: note.id, version: recovered ? (recovered.base?.version ?? 0) : note.version, parentId: note.parentId } : null))
  const [initial] = useState<NoteDraftValues>(() => (note ? (recovered?.base ? fromBase(recovered.base) : fromNote(note)) : EMPTY))
  const [values, setValues] = useState<NoteDraftValues>(() => (recovered ? fromInput(recovered.input) : initial))
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<SaveFailure | null>(null)
  const [conflict, setConflict] = useState<ConflictKind | null>(() => (recoveredConflicts(note, recovered) ? 'conflict' : null))
  const [confirm, setConfirm] = useState<Confirmation>(null)
  const [released, setReleased] = useState(false)

  const targetParent = base ? base.parentId : parentId
  const valuesRef = useRef(values)
  const releasedRef = useRef(false)
  const inflight = useRef<Promise<MutationResult> | null>(null)
  const pendingGuard = useRef<((allow: boolean) => void) | null>(null)
  const latest = useRef({ library, session, onClose, onResume })
  useEffect(() => {
    latest.current = { library, session, onClose, onResume }
  })

  const dirty = !released && !sameValues(values, initial)

  const update = useCallback((patch: Partial<NoteDraftValues>) => {
    valuesRef.current = { ...valuesRef.current, ...patch }
    setValues(valuesRef.current)
    setFailure(null)
  }, [])

  const release = useCallback(() => {
    releasedRef.current = true
    setReleased(true)
  }, [])

  const fail = useCallback((result: SaveFailure) => {
    setFailure({ code: result.code, message: result.message })
    if (result.code === 'conflict') setConflict('conflict')
    else if (result.code === 'vault-changed') setConflict('replaced')
  }, [])

  // A freshly read context for a write that must not trust the held snapshot.
  // A changed generation is a replaced library, never something to write into.
  const freshContext = useCallback(async (active: VaultSession): Promise<{ ok: true, context: MutationContext } | { ok: false, failure: SaveFailure }> => {
    const fresh = await loadLibrary(active)
    if (!fresh.ok) return { ok: false, failure: { code: fresh.code, message: fresh.message } }
    const held = latest.current.library.snapshot?.meta.generation
    if (held !== undefined && held !== fresh.snapshot.meta.generation) {
      return { ok: false, failure: { code: 'vault-changed', message: 'This library was replaced. Unlock the current library to continue.' } }
    }
    return { ok: true, context: { generation: fresh.snapshot.meta.generation, expectedRevision: fresh.snapshot.meta.revision } }
  }, [])

  // The one write path shared by Save, the shortcut, and Save and lock. A call
  // made while a write is pending, or after one committed, returns that same
  // outcome instead of writing again.
  const save = useCallback((): Promise<MutationResult> => {
    if (inflight.current) return inflight.current
    const input = toInput(valuesRef.current, targetParent)
    const issues = validateNoteInput(input)
    if (issues.length > 0) {
      const result: MutationResult = { ok: false, code: 'validation', message: issues[0].message }
      setFailure({ code: 'validation', message: issues[0].message })
      return Promise.resolve(result)
    }
    setSaving(true)
    setFailure(null)
    const run = (async (): Promise<MutationResult> => {
      let result: MutationResult
      try {
        result = await latest.current.library.runMutation((active, context) =>
          base
            ? updateNote(active, { ...context, expectedVersion: base.version }, base.id, input)
            : createNote(active, context, input))
      } catch {
        result = { ok: false, code: 'unavailable', message: UNAVAILABLE }
      }
      // A new note has no identity to conflict with, so a revision-only
      // conflict (another tab saved something else) is retried once against a
      // refreshed context. Notes that already exist never retry.
      if (!result.ok && result.code === 'conflict' && !base) {
        try {
          const active = latest.current.session
          const fresh = active ? await freshContext(active) : null
          if (fresh && !fresh.ok) result = { ok: false, ...fresh.failure }
          else if (fresh) {
            result = await latest.current.library.runMutation((current) => createNote(current, fresh.context, input))
          }
        } catch {
          result = { ok: false, code: 'unavailable', message: UNAVAILABLE }
        }
      }
      if (result.ok) {
        release()
        latest.current.onClose('saved')
      } else {
        inflight.current = null
        setSaving(false)
        fail(result)
      }
      return result
    })()
    inflight.current = run
    return run
  }, [base, targetParent, release, fail, freshContext])

  // Used by the conflict panel: writes the draft as a brand new note against a
  // freshly read library, so the latest persisted version is never replaced.
  const saveAsNew = useCallback(async (): Promise<MutationResult> => {
    if (inflight.current) return inflight.current
    const input = toInput(valuesRef.current, targetParent)
    const issues = validateNoteInput(input)
    if (issues.length > 0) {
      setFailure({ code: 'validation', message: issues[0].message })
      return { ok: false, code: 'validation', message: issues[0].message }
    }
    setSaving(true)
    setFailure(null)
    const run = (async (): Promise<MutationResult> => {
      let result: MutationResult
      try {
        const active = latest.current.session
        if (!active) {
          result = { ok: false, code: 'unavailable', message: 'This library is locked.' }
        } else {
          const fresh = await freshContext(active)
          result = fresh.ok
            ? await latest.current.library.runMutation((current) => createNote(current, fresh.context, input))
            : { ok: false, ...fresh.failure }
        }
      } catch {
        result = { ok: false, code: 'unavailable', message: UNAVAILABLE }
      }
      if (result.ok) {
        release()
        latest.current.onClose('saved-new')
      } else {
        inflight.current = null
        setSaving(false)
        if (result.code === 'vault-changed') setConflict('replaced')
        setFailure({ code: result.code, message: result.message })
      }
      return result
    })()
    inflight.current = run
    return run
  }, [targetParent, release, freshContext])

  const requestLeave = useCallback((): boolean => {
    if (releasedRef.current) return true
    // Leaving while a write is pending could report Saved after discarding.
    if (inflight.current) return false
    if (sameValues(valuesRef.current, initial)) return true
    setConfirm('leave')
    return false
  }, [initial])

  const answerConfirm = useCallback((discard: boolean) => {
    const kind = confirm
    setConfirm(null)
    if (kind === 'navigate') {
      const pending = pendingGuard.current
      pendingGuard.current = null
      if (discard) {
        release()
        latest.current.onClose('navigated')
      }
      pending?.(discard)
    } else if (discard) {
      release()
      latest.current.onClose('closed')
    }
  }, [confirm, release])

  // Dirty drafts are visible to the vault (manual and automatic lock) and to
  // navigation (links, Back, Home).
  useEffect(() => {
    if (!dirty) return
    return registerDraft({
      read: () => ({
        noteId: base?.id ?? null,
        input: toInput(valuesRef.current, targetParent),
        ...(base ? { base: { version: base.version, ...initial } } : {}),
      }),
      save: () => save(),
      discard: () => release(),
      cancel: () => latest.current.onResume(),
    })
  }, [dirty, registerDraft, save, release, base, targetParent, initial])

  useEffect(() => {
    if (!dirty) return
    const remove = registerGuard(() => {
      if (releasedRef.current) return true
      if (inflight.current) return false
      return new Promise<boolean>((resolve) => {
        pendingGuard.current?.(false)
        pendingGuard.current = resolve
        setConfirm('navigate')
      })
    })
    return () => {
      remove()
      pendingGuard.current?.(false)
      pendingGuard.current = null
    }
  }, [dirty, registerGuard])

  useEffect(() => {
    if (!dirty) return
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])

  return {
    values,
    isEdit: base !== null,
    dirty,
    saving,
    failure,
    conflict,
    confirm,
    setTitle: (title: string) => update({ title }),
    setBody: (body: string) => update({ body }),
    setSecret: (isSecret: boolean) => update({ isSecret }),
    input: () => toInput(valuesRef.current, targetParent),
    save,
    saveAsNew,
    requestLeave,
    answerConfirm,
    openConflict: (kind: ConflictKind) => setConflict(kind),
    closeConflict: () => { setConflict(null); setFailure(null) },
    release,
  }
}
