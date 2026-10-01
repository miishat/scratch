import { decryptItem, encryptItem, openEnvelope, sealEnvelope, unlockVault } from '../vault/crypto'
import { sameVault } from '../vault/session'
import type { CipherEnvelope, VaultHeader, VaultSession } from '../vault/types'
import type { DraftContent } from '../vault/session'
import { validateTree } from '../library/hierarchy'
import { readStoredSnapshot, replaceLibrary } from '../library/repository'
import type { LibraryItem, LibrarySnapshot, MutationFailureCode, StoredItem } from '../library/types'
import { APP_LIMITS } from '../library/types'
import { isBlank, isItemKind, validateItem, validateNoteInput } from '../library/validation'
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  type BackupFailure,
  type BackupFailureCode,
  type BackupFile,
  type CommitResult,
  type ExportResult,
  type ImportBase,
  type PrepareResult,
  type PreparedBackup,
} from './types'

// Portable encrypted backups. Export reads one consistent stored snapshot and
// encrypts outside any transaction. Import authenticates and validates the
// complete library before anything is shown or written; only commitImport changes
// storage, through the repository's single replacement transaction. Passphrases
// are only ever passed through to unlockVault and are never stored or logged,
// and every message here is safe to show: it never includes content.

// Mirrors the pinned format in src/features/vault/crypto.ts so a file is refused
// before any derivation happens.
const PBKDF2_ITERATIONS = 600000
const SALT_BYTES = 16
const NONCE_BYTES = 12
const WRAPPED_KEY_MIN_BYTES = 32 + 16
const TAG_BYTES = 16
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const UNLOCK_MESSAGE = 'Could not unlock this backup. Check the passphrase and file.'
const INVALID_MESSAGE = 'This backup is not a valid Scratch library.'

function failure(code: BackupFailureCode, message: string): BackupFailure {
  return { ok: false, code, message }
}

// --- file names and download -------------------------------------------------

function two(value: number): string {
  return String(value).padStart(2, '0')
}

// Local date and time, never UTC: scratch-backup-YYYY-MM-DD-HHmm.scratch.
export function backupFilename(date: Date): string {
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
  return `scratch-backup-${day}-${two(date.getHours())}${two(date.getMinutes())}.scratch`
}

const REVOKE_DELAY_MS = 10_000

// Hands the file to the browser. The object URL is released shortly afterwards,
// once the browser has taken over the download.
export function saveBackupFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.rel = 'noopener'
    link.hidden = true
    document.body.append(link)
    link.click()
    link.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
  }
}

// --- writing -----------------------------------------------------------------

function compareIds(a: StoredItem, b: StoredItem): number {
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

// The one versioned backup writer. Standard and recovery exports both use it.
// The envelope plaintext is the vault ID plus the complete record set sorted by
// ID; the header's wrapper authenticates the KDF fields.
export async function writeBackup(
  session: VaultSession,
  records: StoredItem[],
  now: Date = new Date(),
): Promise<ExportResult> {
  const sorted = [...records]
    .sort(compareIds)
    .map((record): StoredItem => ({
      id: record.id,
      vaultId: record.vaultId,
      parentId: record.parentId,
      kind: record.kind,
      version: record.version,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      payload: { nonce: record.payload.nonce, ciphertext: record.payload.ciphertext },
    }))
  const plaintext = encoder.encode(JSON.stringify({ vaultId: session.header.vaultId, records: sorted }))
  let snapshot: CipherEnvelope
  try {
    snapshot = await sealEnvelope(session, 'backup', plaintext)
  } catch {
    return failure('unavailable', 'Could not create the backup. Try again.')
  } finally {
    plaintext.fill(0)
  }
  const header = session.header
  const file: BackupFile = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    header: {
      formatVersion: header.formatVersion,
      vaultId: header.vaultId,
      salt: header.salt,
      iterations: header.iterations,
      wrappedDataKey: { nonce: header.wrappedDataKey.nonce, ciphertext: header.wrappedDataKey.ciphertext },
    },
    snapshot,
  }
  const blob = new Blob([JSON.stringify(file)], { type: 'application/octet-stream' })
  if (blob.size > APP_LIMITS.importMaxBytes) {
    return failure('too-large', 'This library is too large to export as one backup file. Delete or shorten some notes and try again.')
  }
  return { ok: true, blob, filename: backupFilename(now) }
}

async function decryptAll(session: VaultSession, records: StoredItem[]): Promise<LibraryItem[] | null> {
  const items: LibraryItem[] = []
  for (const record of records) {
    const result = await decryptItem(session, record)
    if (!result.ok) return null
    items.push(result.item)
  }
  return items
}

// Exports the saved library. The stored snapshot is read in one readonly
// transaction and must still match this session (vault, generation, and header
// wrapper); otherwise the caller is asked to refresh instead of receiving an
// ambiguous backup. The records are checked to be restorable before encrypting.
export async function exportBackup(session: VaultSession, now: Date = new Date()): Promise<ExportResult> {
  const stored = await readStoredSnapshot()
  if (!stored.ok) return failure('unavailable', 'Could not read the library to export it. Try again.')
  const { header, meta, items } = stored.snapshot
  if (!sameVault(session, { header, meta })) {
    return failure('stale', 'This library changed in another tab. Lock and unlock to refresh, then export again.')
  }
  const decrypted = await decryptAll(session, items)
  if (!decrypted || validateTree(decrypted).length > 0) {
    return failure('invalid', 'The stored library could not be verified, so it was not exported.')
  }
  return writeBackup(session, items, now)
}

// Exports the old in-memory library plus an unsaved draft without reading or
// writing the database, using the captured session and header. A draft for a
// note that no longer exists, or aimed at a missing collection, is filed as a new
// top-level note. Invalid drafts are refused so the editor keeps them.
export async function exportRecoveryBackup(
  session: VaultSession,
  memorySnapshot: LibrarySnapshot | null,
  draft: DraftContent,
  now: Date = new Date(),
): Promise<ExportResult> {
  if (!memorySnapshot) return failure('unavailable', 'This library is not loaded, so a backup cannot be made.')
  const issues = validateNoteInput(draft.input)
  if (issues.length > 0) return failure('invalid-draft', issues[0].message)

  const items = [...memorySnapshot.items]
  const at = now.getTime()
  const title = isBlank(draft.input.title) ? null : draft.input.title
  const index = draft.noteId === null ? -1 : items.findIndex((entry) => entry.id === draft.noteId && entry.kind === 'note')
  if (index >= 0) {
    const existing = items[index]
    items[index] = {
      ...existing,
      version: existing.version + 1,
      updatedAt: Math.max(at, existing.createdAt, existing.updatedAt),
      title,
      body: draft.input.body,
      isSecret: draft.input.isSecret,
    }
  } else {
    if (items.length >= APP_LIMITS.maxItems) {
      return failure('invalid-draft', `A library can hold at most ${APP_LIMITS.maxItems} items.`)
    }
    const wanted = draft.input.parentId
    const parentId = wanted !== null && items.some((entry) => entry.id === wanted && entry.kind === 'collection') ? wanted : null
    items.push({
      id: crypto.randomUUID(),
      vaultId: session.header.vaultId,
      parentId,
      kind: 'note',
      version: 1,
      createdAt: at,
      updatedAt: at,
      title,
      body: draft.input.body,
      isSecret: draft.input.isSecret,
      color: null,
    })
  }
  if (items.some((entry) => validateItem(entry).length > 0) || validateTree(items).length > 0) {
    return failure('invalid-draft', 'This note cannot be placed in the library. Discard it or copy its text first.')
  }
  try {
    const records: StoredItem[] = []
    for (const entry of items) records.push(await encryptItem(session, entry))
    return await writeBackup(session, records, now)
  } catch {
    return failure('unavailable', 'Could not create the backup. Try again.')
  }
}

// --- preflight ---------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function base64Bytes(value: unknown): number | null {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 || !BASE64_RE.test(value)) return null
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return (value.length / 4) * 3 - padding
}

function extraKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).some((key) => !allowed.includes(key))
}

function malformed(): BackupFailure {
  return failure('malformed', 'This file is not a Scratch backup.')
}

function unsupported(): BackupFailure {
  return failure('unsupported', 'This backup uses a format this version of Scratch does not support.')
}

function validEnvelope(value: unknown, minCiphertextBytes: number): value is CipherEnvelope {
  if (!isRecord(value) || extraKeys(value, ['nonce', 'ciphertext'])) return false
  if (base64Bytes(value.nonce) !== NONCE_BYTES) return false
  const bytes = base64Bytes(value.ciphertext)
  return bytes !== null && bytes >= minCiphertextBytes
}

// Checks the whole outer structure, version, and KDF parameters. No key is
// derived and nothing is decrypted until this passes.
function preflight(text: string): { ok: true; file: BackupFile } | BackupFailure {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return malformed()
  }
  if (!isRecord(parsed)) return malformed()
  if (extraKeys(parsed, ['format', 'formatVersion', 'exportedAt', 'header', 'snapshot'])) return unsupported()
  if (typeof parsed.format !== 'string' || typeof parsed.exportedAt !== 'string') return malformed()
  if (parsed.format !== BACKUP_FORMAT || parsed.formatVersion !== BACKUP_FORMAT_VERSION) return unsupported()
  if (parsed.exportedAt.length > 64 || Number.isNaN(Date.parse(parsed.exportedAt))) return malformed()

  const header = parsed.header
  if (!isRecord(header)) return malformed()
  if (extraKeys(header, ['formatVersion', 'vaultId', 'salt', 'iterations', 'wrappedDataKey'])) return unsupported()
  if (header.formatVersion !== 1) return unsupported()
  if (typeof header.iterations !== 'number') return malformed()
  if (header.iterations !== PBKDF2_ITERATIONS) return unsupported()
  if (typeof header.vaultId !== 'string' || header.vaultId.length === 0 || header.vaultId.length > 128) return malformed()
  if (base64Bytes(header.salt) !== SALT_BYTES) return malformed()
  if (!validEnvelope(header.wrappedDataKey, WRAPPED_KEY_MIN_BYTES)) return malformed()
  if (!validEnvelope(parsed.snapshot, TAG_BYTES)) return malformed()
  return { ok: true, file: parsed as unknown as BackupFile }
}

const RECORD_KEYS = ['id', 'vaultId', 'parentId', 'kind', 'version', 'createdAt', 'updatedAt', 'payload']

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function validRecord(value: unknown, vaultId: string): value is StoredItem {
  if (!isRecord(value) || Object.keys(value).length !== RECORD_KEYS.length || extraKeys(value, RECORD_KEYS)) return false
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.vaultId === vaultId &&
    (value.parentId === null || (typeof value.parentId === 'string' && value.parentId.length > 0)) &&
    isItemKind(value.kind) &&
    isNonNegativeInteger(value.version) &&
    value.version >= 1 &&
    isNonNegativeInteger(value.createdAt) &&
    isNonNegativeInteger(value.updatedAt) &&
    value.updatedAt >= value.createdAt &&
    validEnvelope(value.payload, TAG_BYTES)
  )
}

// --- import ------------------------------------------------------------------

function stagingGeneration(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] + 1
}

function parseSnapshot(plaintext: Uint8Array, header: VaultHeader): StoredItem[] | BackupFailure {
  let parsed: unknown
  try {
    parsed = JSON.parse(decoder.decode(plaintext))
  } catch {
    return failure('invalid', INVALID_MESSAGE)
  }
  if (!isRecord(parsed) || Object.keys(parsed).length !== 2 || parsed.vaultId !== header.vaultId || !Array.isArray(parsed.records)) {
    return failure('invalid', INVALID_MESSAGE)
  }
  if (parsed.records.length > APP_LIMITS.maxItems) {
    return failure('invalid', `This backup holds more than ${APP_LIMITS.maxItems} items, more than a library can hold.`)
  }
  const ids = new Set<string>()
  const records: StoredItem[] = []
  for (const candidate of parsed.records) {
    if (!validRecord(candidate, header.vaultId) || ids.has(candidate.id)) return failure('invalid', INVALID_MESSAGE)
    ids.add(candidate.id)
    records.push(candidate)
  }
  return records
}

// Reads, authenticates, decrypts, and validates a backup file without writing
// anything. The passphrase is used once for derivation and not kept. A wrong
// passphrase and any authentication failure give the same message and never
// produce a library.
export async function prepareImport(file: Blob, backupPassphrase: string): Promise<PrepareResult> {
  if (file.size > APP_LIMITS.importMaxBytes) {
    return failure('too-large', 'This file is larger than 32 MiB, so it cannot be a Scratch backup.')
  }
  if (backupPassphrase.length === 0) return failure('unlock', 'Enter the backup passphrase.')
  let text: string
  try {
    text = await file.text()
  } catch {
    return failure('malformed', 'This file could not be read.')
  }
  const checked = preflight(text)
  if (!checked.ok) return checked
  const { header, snapshot } = checked.file

  const unlocked = await unlockVault(header, backupPassphrase, stagingGeneration())
  if (!unlocked.ok) return failure('unlock', UNLOCK_MESSAGE)
  const { session } = unlocked
  const opened = await openEnvelope(session, 'backup', snapshot)
  if (!opened.ok) return failure('unlock', UNLOCK_MESSAGE)
  const records = parseSnapshot(opened.plaintext, header)
  opened.plaintext.fill(0)
  if (!Array.isArray(records)) return records

  const items = await decryptAll(session, records)
  if (!items || validateTree(items).length > 0) return failure('invalid', INVALID_MESSAGE)
  const prepared: PreparedBackup = { header, records, itemCount: records.length, session }
  return { ok: true, prepared }
}

const COMMIT_FAILURES: Record<MutationFailureCode, { code: BackupFailureCode; message: string } | null> = {
  conflict: { code: 'conflict', message: 'This library changed after you chose the backup. Choose the backup again to review it before replacing.' },
  'vault-changed': { code: 'vault-changed', message: 'This library was replaced after you chose the backup. Unlock the current library and start again.' },
  quota: { code: 'quota', message: 'Not enough storage space to restore this backup. Your library was not changed.' },
  unavailable: { code: 'unavailable', message: 'Local storage is unavailable. Your library was not changed. Try again.' },
  validation: { code: 'invalid', message: INVALID_MESSAGE },
  corrupt: { code: 'invalid', message: INVALID_MESSAGE },
}

// Writes a prepared backup in one replacement transaction. The base is the
// generation and revision of the library that was reviewed (null for an initial
// import); any change since then aborts without writing. On success the
// returned session carries the generation the repository actually assigned.
export async function commitImport(prepared: PreparedBackup, base: ImportBase): Promise<CommitResult> {
  const context = base
    ? { expectedGeneration: base.generation, expectedRevision: base.revision }
    : { expectedGeneration: null, expectedRevision: null }
  const result = await replaceLibrary(prepared.session, context, prepared.records)
  if (!result.ok) {
    const mapped = COMMIT_FAILURES[result.code] ?? COMMIT_FAILURES.unavailable
    return failure(mapped!.code, mapped!.message)
  }
  return {
    ok: true,
    snapshot: result.snapshot,
    session: { header: prepared.header, generation: result.snapshot.meta.generation, dataKey: prepared.session.dataKey },
  }
}
