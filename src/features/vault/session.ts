import type { ItemId, MutationResult, NoteInput } from '../library/types'
import type { VaultSession } from './types'

// Session timing and the dirty-draft contract. Locking is current-tab only: it
// releases this tab's in-memory session and never touches other tabs or storage.

export const INACTIVITY_LOCK_MS = 10 * 60 * 1000
export const HIDDEN_LOCK_MS = 60 * 1000

export type VaultState = 'setup' | 'locked' | 'unlocking' | 'unlocked' | 'lock-error'

export interface ActionResult {
  ok: boolean
  message?: string
}

// The plaintext of an unsaved note edit. It exists in memory only: automatic
// lock seals it into a draft-purpose envelope before the keys are released.
export interface DraftContent {
  noteId: ItemId | null
  input: NoteInput
}

// An editor registers one of these while its draft is dirty. The vault drives the
// lock choices through it: read for sealing and recovery export, save for Save
// and lock, discard for Discard and lock, cancel when the user keeps editing.
export interface DirtyDraft {
  read(): DraftContent
  save(): Promise<MutationResult>
  discard(): void
  cancel(): void
}

export interface SealedDraft {
  vaultId: string
  generation: number
  envelope: { nonce: string; ciphertext: string }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function encodeDraft(draft: DraftContent): Uint8Array {
  return encoder.encode(JSON.stringify(draft))
}

export function decodeDraft(bytes: Uint8Array): DraftContent | null {
  try {
    const value: unknown = JSON.parse(decoder.decode(bytes))
    if (typeof value !== 'object' || value === null) return null
    const { noteId, input } = value as Record<string, unknown>
    if (noteId !== null && typeof noteId !== 'string') return null
    if (typeof input !== 'object' || input === null) return null
    const fields = input as Record<string, unknown>
    if (typeof fields.body !== 'string' || typeof fields.isSecret !== 'boolean') return null
    if (fields.title !== null && typeof fields.title !== 'string') return null
    if (fields.parentId !== null && typeof fields.parentId !== 'string') return null
    return {
      noteId,
      input: { parentId: fields.parentId, title: fields.title, body: fields.body, isSecret: fields.isSecret },
    }
  } catch {
    return null
  }
}

// A session still describes the stored vault when the vault identity, the
// generation, and the wrapped key record all match what storage now holds.
export function sameVault(
  session: VaultSession,
  stored: { header: VaultSession['header']; meta: { generation: number } },
): boolean {
  const a = session.header
  const b = stored.header
  return (
    a.vaultId === b.vaultId &&
    session.generation === stored.meta.generation &&
    a.salt === b.salt &&
    a.wrappedDataKey.nonce === b.wrappedDataKey.nonce &&
    a.wrappedDataKey.ciphertext === b.wrappedDataKey.ciphertext
  )
}

export function inactivityElapsed(lastActivity: number, now: number): boolean {
  return now - lastActivity >= INACTIVITY_LOCK_MS
}

export function hiddenElapsed(hiddenAt: number, now: number): boolean {
  return now - hiddenAt >= HIDDEN_LOCK_MS
}
