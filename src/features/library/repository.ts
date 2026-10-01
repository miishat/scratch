import type { CipherEnvelope, CreatedVault, VaultHeader, VaultSession } from '../vault/types'
import { decryptItem, encryptItem } from '../vault/crypto'
import type {
  CollectionInput,
  Generation,
  LibraryItem,
  LibrarySnapshot,
  MetaRecord,
  MutationContext,
  MutationFailure,
  MutationResult,
  NoteInput,
  StoredItem,
} from './types'
import { APP_LIMITS } from './types'
import type { TreeError } from './hierarchy'
import { collectionDepth, descendantsOf, validateTree } from './hierarchy'
import { isBlank, isItemKind, validateCollectionInput, validateNoteInput } from './validation'
import { sortItems } from './display'
import { getDatabase, HEADER_KEY, META_KEY } from './database'
import { closeChangeChannel, publishChange } from './changes'

// The atomic encrypted repository. Every validated and encrypted record is
// prepared before a Dexie transaction opens; transactions only compare
// generation, revision, and target version, write records, and increment the
// revision. No Web Crypto, fetch, timer, or clipboard work runs inside a
// transaction. A failure never reports success and never partially writes.
//
// No-library mapping: a missing vault (no header and no meta) is an explicit
// "absent" result from readHeader so setup can distinguish it without treating
// it as an error. Every other entry point that requires a library reports the
// same condition as vault-changed.
//
// Tasks 4+ must not hand-build a VaultSession from a bare header; always use the
// session returned by initializeLibrary so the generation comes from storage.

// --- public result shapes ----------------------------------------------------

export interface StoredHeader {
  header: VaultHeader
  meta: MetaRecord
}

export type ReadHeaderResult =
  | { ok: true; library: 'absent' }
  | { ok: true; library: 'present'; header: StoredHeader }
  | ({ ok: false } & MutationFailure)

export type InitializeResult =
  | { ok: true; session: VaultSession; snapshot: LibrarySnapshot }
  | ({ ok: false } & MutationFailure)

export interface StoredSnapshot {
  header: VaultHeader
  meta: MetaRecord
  items: StoredItem[]
}

export type ReadStoredSnapshotResult =
  | { ok: true; snapshot: StoredSnapshot }
  | ({ ok: false } & MutationFailure)

export type ReplaceLibraryContext =
  | { expectedGeneration: Generation; expectedRevision: number }
  | { expectedGeneration: null; expectedRevision: null }

// --- persistence request -----------------------------------------------------

export type PersistenceState = 'unknown' | 'granted' | 'denied' | 'unsupported'

let persistenceRequested = false
let persistenceState: PersistenceState = 'unknown'

export function getPersistenceState(): PersistenceState {
  return persistenceState
}

// Ask for persistent storage once, after the first successful save. A denial or
// an unavailable API is nonfatal: normal behavior continues and the app must not
// claim a durable backup.
export async function requestPersistence(): Promise<boolean> {
  if (persistenceRequested) return persistenceState === 'granted'
  persistenceRequested = true
  try {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage
    if (!storage || typeof storage.persist !== 'function') {
      persistenceState = 'unsupported'
      return false
    }
    const granted = await storage.persist()
    persistenceState = granted ? 'granted' : 'denied'
    return granted
  } catch {
    persistenceState = 'denied'
    return false
  }
}

// Test isolation: forget process-level state between cases.
export function resetRepositoryForTests(): void {
  persistenceRequested = false
  persistenceState = 'unknown'
  closeChangeChannel()
}

// --- failure helpers ---------------------------------------------------------

function validationFailure(message: string): MutationFailure {
  return { code: 'validation', message }
}

function conflictFailure(): MutationFailure {
  return { code: 'conflict', message: 'Another tab changed this library. Review the latest version and try again.' }
}

function vaultChangedFailure(): MutationFailure {
  return { code: 'vault-changed', message: 'This library was replaced. Unlock the current library to continue.' }
}

function unavailableFailure(): MutationFailure {
  return { code: 'unavailable', message: 'Local storage is unavailable. Try again.' }
}

function corruptFailure(message: string): MutationFailure {
  return { code: 'corrupt', message }
}

function limitMessage(): string {
  return `A library can hold at most ${APP_LIMITS.maxItems} items.`
}

function treeErrorMessage(errors: TreeError[]): string {
  const first = errors[0]
  switch (first.code) {
    case 'excessive-depth':
      return `Collections can be nested at most ${APP_LIMITS.maxCollectionDepth} levels deep.`
    case 'cycle':
      return 'A collection cannot be moved into itself or its descendants.'
    case 'note-parent':
      return 'Items can only be placed in a collection.'
    case 'missing-parent':
      return 'The destination no longer exists.'
    default:
      return 'That change is not allowed.'
  }
}

function errorNames(error: unknown): string[] {
  const names: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth++) {
    if (typeof current !== 'object') break
    const record = current as { name?: unknown; cause?: unknown; inner?: unknown }
    if (typeof record.name === 'string') names.push(record.name)
    current = record.cause ?? record.inner
  }
  return names
}

function mapError(error: unknown): MutationFailure {
  for (const name of errorNames(error)) {
    if (name === 'QuotaExceededError') {
      return { code: 'quota', message: 'Not enough storage space to save. Free some space and try again.' }
    }
    if (name === 'ConstraintError') {
      return validationFailure('That change conflicts with existing data.')
    }
  }
  return unavailableFailure()
}

// --- structural checks -------------------------------------------------------

// The pinned vault format. These lengths and the iteration count must match
// src/features/vault/crypto.ts so an unsupported header is never persisted.
const PBKDF2_ITERATIONS = 600000
const SALT_BYTES = 16
const NONCE_BYTES = 12
const WRAPPED_KEY_MIN_BYTES = 32 + 16
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/

function base64ByteLength(value: unknown): number | null {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 || !BASE64_RE.test(value)) return null
  try {
    return atob(value).length
  } catch {
    return null
  }
}

function isEnvelope(value: unknown): value is CipherEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const envelope = value as Record<string, unknown>
  return typeof envelope.nonce === 'string' && typeof envelope.ciphertext === 'string' && envelope.nonce.length > 0 && envelope.ciphertext.length > 0
}

function isVaultHeader(value: unknown): value is VaultHeader {
  if (typeof value !== 'object' || value === null) return false
  const header = value as Record<string, unknown>
  if (header.formatVersion !== 1) return false
  if (typeof header.vaultId !== 'string' || header.vaultId.length === 0) return false
  if (header.iterations !== PBKDF2_ITERATIONS) return false
  if (base64ByteLength(header.salt) !== SALT_BYTES) return false
  if (!isEnvelope(header.wrappedDataKey)) return false
  const wrapped = header.wrappedDataKey
  if (base64ByteLength(wrapped.nonce) !== NONCE_BYTES) return false
  const ciphertextBytes = base64ByteLength(wrapped.ciphertext)
  if (ciphertextBytes === null || ciphertextBytes < WRAPPED_KEY_MIN_BYTES) return false
  return true
}

function isMetaRecord(value: unknown): value is MetaRecord {
  if (typeof value !== 'object' || value === null) return false
  const meta = value as Record<string, unknown>
  return (
    typeof meta.revision === 'number' &&
    Number.isInteger(meta.revision) &&
    meta.revision >= 0 &&
    typeof meta.generation === 'number' &&
    Number.isInteger(meta.generation) &&
    meta.generation >= 1
  )
}

function isStoredRow(value: unknown): value is StoredItem {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    row.id.length > 0 &&
    typeof row.vaultId === 'string' &&
    row.vaultId.length > 0 &&
    (row.parentId === null || typeof row.parentId === 'string') &&
    isItemKind(row.kind) &&
    typeof row.version === 'number' &&
    Number.isInteger(row.version) &&
    row.version >= 1 &&
    typeof row.createdAt === 'number' &&
    Number.isInteger(row.createdAt) &&
    row.createdAt >= 0 &&
    typeof row.updatedAt === 'number' &&
    Number.isInteger(row.updatedAt) &&
    row.updatedAt >= row.createdAt &&
    isEnvelope(row.payload)
  )
}

function structuralItem(row: StoredItem): LibraryItem {
  return {
    id: row.id,
    vaultId: row.vaultId,
    parentId: row.parentId,
    kind: row.kind,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    title: null,
    body: null,
    isSecret: false,
    color: null,
  }
}

function nextUpdatedAt(now: number, previous: Pick<LibraryItem, 'createdAt' | 'updatedAt'>): number {
  return Math.max(now, previous.updatedAt, previous.createdAt)
}

function requireVersion(context: MutationContext): number | null {
  const value = context.expectedVersion
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) return value
  return null
}

// The success snapshot is built from in-memory decrypted items the caller
// already committed, so it cannot turn a committed write into a failure.
function resultSnapshot(header: VaultHeader, meta: MetaRecord, items: LibraryItem[]): MutationResult {
  return { ok: true, snapshot: { header, meta, items: sortItems(items) } }
}

// --- core reads --------------------------------------------------------------

interface CoreState {
  header: VaultHeader
  meta: MetaRecord
  rows: StoredItem[]
}

type CoreResult =
  | { status: 'ok'; state: CoreState }
  | { status: 'empty' }
  | { status: 'corrupt'; message: string }

interface HeaderCore {
  header: VaultHeader
  meta: MetaRecord
}

type HeaderCoreResult =
  | { status: 'ok'; value: HeaderCore }
  | { status: 'empty' }
  | { status: 'corrupt'; message: string }

// Reads only the header and meta rows. This never opens the items store, so
// deciding setup versus locked stays cheap on every cold start.
async function headerWithin(): Promise<HeaderCoreResult> {
  const db = getDatabase()
  const vaultRow = await db.vault.get(HEADER_KEY)
  const metaRow = await db.meta.get(META_KEY)
  if (!vaultRow && !metaRow) return { status: 'empty' }
  if (!vaultRow || !metaRow) return { status: 'corrupt', message: 'Local storage is inconsistent.' }
  if (!isVaultHeader(vaultRow.header) || !isMetaRecord(metaRow)) {
    return { status: 'corrupt', message: 'Local storage is corrupted.' }
  }
  return { status: 'ok', value: { header: vaultRow.header, meta: { revision: metaRow.revision, generation: metaRow.generation } } }
}

async function readHeaderCore(): Promise<HeaderCoreResult> {
  const db = getDatabase()
  return db.transaction('r', db.vault, db.meta, () => headerWithin())
}

// Reads header, meta, and items on the ambient transaction (or a fresh one if
// none is open). No decryption happens here.
async function coreWithin(): Promise<CoreResult> {
  const db = getDatabase()
  const vaultRow = await db.vault.get(HEADER_KEY)
  const metaRow = await db.meta.get(META_KEY)
  if (!vaultRow && !metaRow) {
    const items = await db.items.toArray()
    if (items.length > 0) return { status: 'corrupt', message: 'Local storage is inconsistent.' }
    return { status: 'empty' }
  }
  if (!vaultRow || !metaRow) return { status: 'corrupt', message: 'Local storage is inconsistent.' }
  if (!isVaultHeader(vaultRow.header) || !isMetaRecord(metaRow)) {
    return { status: 'corrupt', message: 'Local storage is corrupted.' }
  }
  const rows = await db.items.toArray()
  for (const row of rows) {
    if (!isStoredRow(row)) return { status: 'corrupt', message: 'A stored item is corrupted.' }
  }
  return {
    status: 'ok',
    state: {
      header: vaultRow.header,
      meta: { revision: metaRow.revision, generation: metaRow.generation },
      rows,
    },
  }
}

async function readCore(): Promise<CoreResult> {
  const db = getDatabase()
  return db.transaction('r', db.vault, db.items, db.meta, () => coreWithin())
}

function coreFailure(core: CoreResult): MutationFailure {
  if (core.status === 'corrupt') return corruptFailure(core.message)
  if (core.status === 'empty') return vaultChangedFailure()
  return unavailableFailure()
}

function stateFailure(
  state: CoreState,
  session: VaultSession,
  context: MutationContext,
  checkRevision: boolean,
): MutationFailure | null {
  if (state.header.vaultId !== session.header.vaultId) return vaultChangedFailure()
  if (state.meta.generation !== context.generation) return vaultChangedFailure()
  if (checkRevision && state.meta.revision !== context.expectedRevision) return conflictFailure()
  return null
}

// --- transaction plumbing ----------------------------------------------------

interface WriteOutcome {
  state: CoreState | null
  failure: MutationFailure | null
}

async function runWrite(work: () => Promise<WriteOutcome>): Promise<WriteOutcome> {
  try {
    const db = getDatabase()
    return await db.transaction('rw', db.vault, db.items, db.meta, work)
  } catch (error) {
    return { state: null, failure: mapError(error) }
  }
}

async function decryptRows(
  session: VaultSession,
  rows: StoredItem[],
): Promise<{ ok: true; items: LibraryItem[] } | { ok: false; failure: MutationFailure }> {
  const items: LibraryItem[] = []
  for (const row of rows) {
    const result = await decryptItem(session, row)
    if (!result.ok) return { ok: false, failure: corruptFailure(result.message) }
    items.push(result.item)
  }
  return { ok: true, items }
}

// Read the whole library and decrypt it before a mutation prepares its write.
// The generation, vault, and revision are checked first so a stale session on a
// replaced vault reports vault-changed (or conflict) instead of a decrypt
// failure. Any decryption failure after that is a genuine pre-commit failure.
async function readDecrypted(
  session: VaultSession,
  context: MutationContext,
  checkRevision: boolean,
): Promise<{ ok: true; state: CoreState; items: LibraryItem[] } | { ok: false; failure: MutationFailure }> {
  const core = await readCore()
  if (core.status !== 'ok') return { ok: false, failure: coreFailure(core) }
  const failure = stateFailure(core.state, session, context, checkRevision)
  if (failure) return { ok: false, failure }
  const decrypted = await decryptRows(session, core.state.rows)
  if (!decrypted.ok) return { ok: false, failure: decrypted.failure }
  return { ok: true, state: core.state, items: decrypted.items }
}

async function snapshotFromStored(
  session: VaultSession,
  header: VaultHeader,
  meta: MetaRecord,
  rows: StoredItem[],
): Promise<MutationResult> {
  const decrypted = await decryptRows(session, rows)
  if (!decrypted.ok) return { ok: false, ...decrypted.failure }
  const errors = validateTree(decrypted.items)
  if (errors.length > 0) return { ok: false, code: 'corrupt', message: 'The stored library is not a valid tree.' }
  return { ok: true, snapshot: { header, meta, items: sortItems(decrypted.items) } }
}

// Runs after a transaction has committed. Neither the persistence request nor
// the notification may fail the mutation result.
async function completeMutation(result: MutationResult): Promise<MutationResult> {
  if (!result.ok) return result
  await requestPersistence()
  publishChange({
    vaultId: result.snapshot.header.vaultId,
    generation: result.snapshot.meta.generation,
    revision: result.snapshot.meta.revision,
  })
  return result
}

function requireCommitted(outcome: WriteOutcome): MutationFailure | null {
  return outcome.failure ?? (outcome.state ? null : unavailableFailure())
}

// --- header / load / raw snapshot --------------------------------------------

export async function readHeader(): Promise<ReadHeaderResult> {
  try {
    const header = await readHeaderCore()
    if (header.status === 'empty') return { ok: true, library: 'absent' }
    if (header.status === 'corrupt') return { ok: false, ...corruptFailure(header.message) }
    return { ok: true, library: 'present', header: header.value }
  } catch (error) {
    return { ok: false, ...mapError(error) }
  }
}

export async function loadLibrary(session: VaultSession): Promise<MutationResult> {
  try {
    const core = await readCore()
    if (core.status !== 'ok') return { ok: false, ...coreFailure(core) }
    if (core.state.header.vaultId !== session.header.vaultId) return { ok: false, ...vaultChangedFailure() }
    if (core.state.meta.generation !== session.generation) return { ok: false, ...vaultChangedFailure() }
    return await snapshotFromStored(session, core.state.header, core.state.meta, core.state.rows)
  } catch (error) {
    return { ok: false, ...mapError(error) }
  }
}

export async function readStoredSnapshot(): Promise<ReadStoredSnapshotResult> {
  try {
    const core = await readCore()
    if (core.status !== 'ok') return { ok: false, ...coreFailure(core) }
    return { ok: true, snapshot: { header: core.state.header, meta: core.state.meta, items: core.state.rows } }
  } catch (error) {
    return { ok: false, ...mapError(error) }
  }
}

// --- initialize --------------------------------------------------------------

export async function initializeLibrary(created: CreatedVault): Promise<InitializeResult> {
  try {
    if (!isVaultHeader(created.header)) return { ok: false, ...validationFailure('The vault header is invalid.') }
    const outcome = await runWrite(async () => {
      const vaultRow = await getDatabase().vault.get(HEADER_KEY)
      const metaRow = await getDatabase().meta.get(META_KEY)
      const itemCount = await getDatabase().items.count()
      if (vaultRow || metaRow) return { state: null, failure: { code: 'conflict', message: 'A library already exists in this browser.' } }
      if (itemCount > 0) return { state: null, failure: corruptFailure('Local storage is inconsistent.') }
      const meta: MetaRecord = { generation: 1, revision: 1 }
      await getDatabase().vault.put({ key: HEADER_KEY, header: created.header })
      await getDatabase().meta.put({ key: META_KEY, ...meta })
      return { state: { header: created.header, meta, rows: [] }, failure: null }
    })
    const failure = requireCommitted(outcome)
    if (failure || !outcome.state) return { ok: false, ...(failure ?? unavailableFailure()) }
    const generation = outcome.state.meta.generation
    publishChange({ vaultId: created.header.vaultId, generation, revision: outcome.state.meta.revision })
    return {
      ok: true,
      session: { header: created.header, generation, dataKey: created.dataKey },
      snapshot: { header: created.header, meta: outcome.state.meta, items: [] },
    }
  } catch (error) {
    return { ok: false, ...mapError(error) }
  }
}

// --- create ------------------------------------------------------------------

export async function createNote(
  session: VaultSession,
  context: MutationContext,
  input: NoteInput,
): Promise<MutationResult> {
  try {
    const issues = validateNoteInput(input)
    if (issues.length > 0) return { ok: false, ...validationFailure(issues[0].message) }
    const pre = await readDecrypted(session, context, true)
    if (!pre.ok) return { ok: false, ...pre.failure }

    const now = Date.now()
    const item: LibraryItem = {
      id: crypto.randomUUID(),
      vaultId: session.header.vaultId,
      parentId: input.parentId,
      kind: 'note',
      version: 1,
      createdAt: now,
      updatedAt: now,
      title: isBlank(input.title) ? null : input.title,
      body: input.body,
      isSecret: input.isSecret,
      color: null,
    }
    const stored = await encryptItem(session, item)
    const outcome = await runWrite(async () => {
      const core = await coreWithin()
      const current = core.status === 'ok' ? core.state : null
      if (!current) return { state: null, failure: coreFailure(core) }
      const failure = stateFailure(current, session, context, true)
      if (failure) return { state: null, failure }
      if (current.rows.length >= APP_LIMITS.maxItems) {
        return { state: null, failure: validationFailure(limitMessage()) }
      }
      if (item.parentId !== null) {
        const parent = current.rows.find((row) => row.id === item.parentId)
        if (!parent) return { state: null, failure: validationFailure('The destination no longer exists.') }
        if (parent.kind !== 'collection') return { state: null, failure: validationFailure('A note must be placed in a collection.') }
      }
      await getDatabase().items.put(stored)
      const meta: MetaRecord = { revision: current.meta.revision + 1, generation: current.meta.generation }
      await getDatabase().meta.put({ key: META_KEY, ...meta })
      return { state: { header: current.header, meta, rows: current.rows }, failure: null }
    })
    const failure = requireCommitted(outcome)
    if (failure || !outcome.state) return { ok: false, ...(failure ?? unavailableFailure()) }
    return completeMutation(resultSnapshot(outcome.state.header, outcome.state.meta, [...pre.items, item]))
  } catch (error) {
    return { ok: false, ...mapError(error) }
  }
}

export async function createCollection(
  session: VaultSession,
  context: MutationContext,
  input: CollectionInput,
): Promise<MutationResult> {
  try {
    const issues = validateCollectionInput(input)
    if (issues.length > 0) return { ok: false, ...validationFailure(issues[0].message) }
    const pre = await readDecrypted(session, context, true)
    if (!pre.ok) return { ok: false, ...pre.failure }

    const now = Date.now()
    const item: LibraryItem = {
      id: crypto.randomUUID(),
      vaultId: session.header.vaultId,
      parentId: input.parentId,
      kind: 'collection',
      version: 1,
      createdAt: now,
      updatedAt: now,
      title: input.title,
      body: null,
      isSecret: false,
      color: input.color,
    }
    const stored = await encryptItem(session, item)
    const outcome = await runWrite(async () => {
      const core = await coreWithin()
      const current = core.status === 'ok' ? core.state : null
      if (!current) return { state: null, failure: coreFailure(core) }
      const failure = stateFailure(current, session, context, true)
      if (failure) return { state: null, failure }
      if (current.rows.length >= APP_LIMITS.maxItems) {
        return { state: null, failure: validationFailure(limitMessage()) }
      }
      if (item.parentId !== null) {
        const parent = current.rows.find((row) => row.id === item.parentId)
        if (!parent) return { state: null, failure: validationFailure('The destination no longer exists.') }
        if (parent.kind !== 'collection') return { state: null, failure: validationFailure('A collection must be placed in a collection.') }
      }
      const depth = collectionDepth(current.rows.map(structuralItem), item.parentId)
      if (depth >= APP_LIMITS.maxCollectionDepth) {
        return { state: null, failure: validationFailure(`Collections can be nested at most ${APP_LIMITS.maxCollectionDepth} levels deep.`) }
      }
      await getDatabase().items.put(stored)
      const meta: MetaRecord = { revision: current.meta.revision + 1, generation: current.meta.generation }
      await getDatabase().meta.put({ key: META_KEY, ...meta })
      return { state: { header: current.header, meta, rows: current.rows }, failure: null }
    })
    const failure = requireCommitted(outcome)
    if (failure || !outcome.state) return { ok: false, ...(failure ?? unavailableFailure()) }
    return completeMutation(resultSnapshot(outcome.state.header, outcome.state.meta, [...pre.items, item]))
  } catch (error) {
    return { ok: false, ...mapError(error) }
  }
}

// --- update ------------------------------------------------------------------

export async function updateNote(
  session: VaultSession,
  context: MutationContext,
  id: string,
  input: NoteInput,
): Promise<MutationResult> {
  try {
    const issues = validateNoteInput(input)
    if (issues.length > 0) return { ok: false, ...validationFailure(issues[0].message) }
    const version = requireVersion(context)
    if (version === null) return { ok: false, ...validationFailure('A version is required to update a note.') }

    const pre = await readDecrypted(session, context, true)
    if (!pre.ok) return { ok: false, ...pre.failure }
    const row = pre.state.rows.find((candidate) => candidate.id === id)
    if (!row) return { ok: false, ...validationFailure('That note no longer exists.') }
    if (row.kind !== 'note') return { ok: false, ...validationFailure('That item is not a note.') }
    if (row.version !== version) return { ok: false, ...conflictFailure() }

    const updated: LibraryItem = {
      id: row.id,
      vaultId: row.vaultId,
      parentId: row.parentId,
      kind: 'note',
      version: row.version + 1,
      createdAt: row.createdAt,
      updatedAt: nextUpdatedAt(Date.now(), row),
      title: isBlank(input.title) ? null : input.title,
      body: input.body,
      isSecret: input.isSecret,
      color: null,
    }
    const stored = await encryptItem(session, updated)
    const outcome = await runWrite(async () => {
      const inner = await coreWithin()
      const latest = inner.status === 'ok' ? inner.state : null
      if (!latest) return { state: null, failure: coreFailure(inner) }
      const innerFailure = stateFailure(latest, session, context, true)
      if (innerFailure) return { state: null, failure: innerFailure }
      const latestRow = latest.rows.find((candidate) => candidate.id === id)
      if (!latestRow || latestRow.kind !== 'note' || latestRow.version !== version) {
        return { state: null, failure: conflictFailure() }
      }
      await getDatabase().items.put(stored)
      const meta: MetaRecord = { revision: latest.meta.revision + 1, generation: latest.meta.generation }
      await getDatabase().meta.put({ key: META_KEY, ...meta })
      return { state: { header: latest.header, meta, rows: latest.rows }, failure: null }
    })
    const failure = requireCommitted(outcome)
    if (failure || !outcome.state) return { ok: false, ...(failure ?? unavailableFailure()) }
    const items = pre.items.map((candidate) => (candidate.id === id ? updated : candidate))
    return completeMutation(resultSnapshot(outcome.state.header, outcome.state.meta, items))
  } catch (error) {
    return { ok: false, ...mapError(error) }
  }
}

export async function updateCollection(
  session: VaultSession,
  context: MutationContext,
  id: string,
  input: CollectionInput,
): Promise<MutationResult> {
  try {
    const issues = validateCollectionInput(input)
    if (issues.length > 0) return { ok: false, ...validationFailure(issues[0].message) }
    const version = requireVersion(context)
    if (version === null) return { ok: false, ...validationFailure('A version is required to update a collection.') }

    const pre = await readDecrypted(session, context, true)
    if (!pre.ok) return { ok: false, ...pre.failure }
    const row = pre.state.rows.find((candidate) => candidate.id === id)
    if (!row) return { ok: false, ...validationFailure('That collection no longer exists.') }
    if (row.kind !== 'collection') return { ok: false, ...validationFailure('That item is not a collection.') }
    if (row.version !== version) return { ok: false, ...conflictFailure() }

    const updated: LibraryItem = {
      id: row.id,
      vaultId: row.vaultId,
      parentId: row.parentId,
      kind: 'collection',
      version: row.version + 1,
      createdAt: row.createdAt,
      updatedAt: nextUpdatedAt(Date.now(), row),
      title: input.title,
      body: null,
      isSecret: false,
      color: input.color,
    }
    const stored = await encryptItem(session, updated)
    const outcome = await runWrite(async () => {
      const inner = await coreWithin()
      const latest = inner.status === 'ok' ? inner.state : null
      if (!latest) return { state: null, failure: coreFailure(inner) }
      const innerFailure = stateFailure(latest, session, context, true)
      if (innerFailure) return { state: null, failure: innerFailure }
      const latestRow = latest.rows.find((candidate) => candidate.id === id)
      if (!latestRow || latestRow.kind !== 'collection' || latestRow.version !== version) {
        return { state: null, failure: conflictFailure() }
      }
      await getDatabase().items.put(stored)
      const meta: MetaRecord = { revision: latest.meta.revision + 1, generation: latest.meta.generation }
      await getDatabase().meta.put({ key: META_KEY, ...meta })
      return { state: { header: latest.header, meta, rows: latest.rows }, failure: null }
    })
    const failure = requireCommitted(outcome)
    if (failure || !outcome.state) return { ok: false, ...(failure ?? unavailableFailure()) }
    const items = pre.items.map((candidate) => (candidate.id === id ? updated : candidate))
    return completeMutation(resultSnapshot(outcome.state.header, outcome.state.meta, items))
  } catch (error) {
    return { ok: false, ...mapError(error) }
  }
}

// --- move --------------------------------------------------------------------

export async function moveItem(
  session: VaultSession,
  context: MutationContext,
  id: string,
  newParentId: string | null,
): Promise<MutationResult> {
  try {
    const version = requireVersion(context)
    if (version === null) return { ok: false, ...validationFailure('A version is required to move an item.') }

    const pre = await readDecrypted(session, context, false)
    if (!pre.ok) return { ok: false, ...pre.failure }
    const items = pre.items
    const item = items.find((candidate) => candidate.id === id)
    if (!item) return { ok: false, ...validationFailure('That item no longer exists.') }
    if (item.version !== version) return { ok: false, ...conflictFailure() }

    // A move to the current parent is a real no-op: report the current snapshot
    // without bumping the revision or re-encrypting anything.
    if (item.parentId === newParentId) {
      return resultSnapshot(pre.state.header, pre.state.meta, items)
    }

    if (newParentId !== null) {
      const parent = items.find((candidate) => candidate.id === newParentId)
      if (!parent) return { ok: false, ...validationFailure('The destination no longer exists.') }
      if (parent.kind !== 'collection') return { ok: false, ...validationFailure('Items can only be moved into a collection.') }
    }

    const candidate = items.map((candidate) => (candidate.id === id ? { ...candidate, parentId: newParentId } : candidate))
    const treeErrors = validateTree(candidate)
    if (treeErrors.length > 0) return { ok: false, ...validationFailure(treeErrorMessage(treeErrors)) }

    const moved: LibraryItem = {
      ...item,
      parentId: newParentId,
      version: item.version + 1,
      updatedAt: nextUpdatedAt(Date.now(), item),
    }
    const stored = await encryptItem(session, moved)
    const outcome = await runWrite(async () => {
      const inner = await coreWithin()
      const latest = inner.status === 'ok' ? inner.state : null
      if (!latest) return { state: null, failure: coreFailure(inner) }
      const innerFailure = stateFailure(latest, session, context, true)
      if (innerFailure) return { state: null, failure: innerFailure }
      const latestRow = latest.rows.find((candidate) => candidate.id === id)
      if (!latestRow || latestRow.version !== version || latestRow.parentId !== item.parentId) {
        return { state: null, failure: conflictFailure() }
      }
      if (newParentId !== null) {
        const parent = latest.rows.find((candidate) => candidate.id === newParentId)
        if (!parent || parent.kind !== 'collection') return { state: null, failure: conflictFailure() }
      }
      await getDatabase().items.put(stored)
      const meta: MetaRecord = { revision: latest.meta.revision + 1, generation: latest.meta.generation }
      await getDatabase().meta.put({ key: META_KEY, ...meta })
      return { state: { header: latest.header, meta, rows: latest.rows }, failure: null }
    })
    const failure = requireCommitted(outcome)
    if (failure || !outcome.state) return { ok: false, ...(failure ?? unavailableFailure()) }
    const movedItems = items.map((candidate) => (candidate.id === id ? moved : candidate))
    return completeMutation(resultSnapshot(outcome.state.header, outcome.state.meta, movedItems))
  } catch (error) {
    return { ok: false, ...mapError(error) }
  }
}

// --- delete ------------------------------------------------------------------

export async function deleteItem(
  session: VaultSession,
  context: MutationContext,
  id: string,
): Promise<MutationResult> {
  try {
    const version = requireVersion(context)
    if (version === null) return { ok: false, ...validationFailure('A version is required to delete an item.') }

    const pre = await readDecrypted(session, context, true)
    if (!pre.ok) return { ok: false, ...pre.failure }

    const structural = pre.state.rows.map(structuralItem)
    const target = structural.find((item) => item.id === id)
    if (!target) return { ok: false, ...validationFailure('That item no longer exists.') }
    if (target.version !== version) return { ok: false, ...conflictFailure() }

    // The visited guard in descendantsOf keeps this safe if the stored tree was
    // tampered into a cycle; validateTree then reports the corruption.
    const subtree = [id, ...descendantsOf(structural, id)]
    if (validateTree(structural).length > 0) {
      return { ok: false, ...corruptFailure('The stored library is not a valid tree.') }
    }
    const subtreeKey = [...subtree].sort().join('\u0000')

    const outcome = await runWrite(async () => {
      const inner = await coreWithin()
      const latest = inner.status === 'ok' ? inner.state : null
      if (!latest) return { state: null, failure: coreFailure(inner) }
      const innerFailure = stateFailure(latest, session, context, true)
      if (innerFailure) return { state: null, failure: innerFailure }
      const latestStructural = latest.rows.map(structuralItem)
      const latestTarget = latestStructural.find((item) => item.id === id)
      if (!latestTarget || latestTarget.version !== version) {
        return { state: null, failure: conflictFailure() }
      }
      const latestSubtree = [id, ...descendantsOf(latestStructural, id)]
      if ([...latestSubtree].sort().join('\u0000') !== subtreeKey) {
        return { state: null, failure: conflictFailure() }
      }
      await getDatabase().items.bulkDelete(latestSubtree)
      const meta: MetaRecord = { revision: latest.meta.revision + 1, generation: latest.meta.generation }
      await getDatabase().meta.put({ key: META_KEY, ...meta })
      return { state: { header: latest.header, meta, rows: latest.rows }, failure: null }
    })
    const failure = requireCommitted(outcome)
    if (failure || !outcome.state) return { ok: false, ...(failure ?? unavailableFailure()) }
    const removed = new Set(subtree)
    const items = pre.items.filter((candidate) => !removed.has(candidate.id))
    return completeMutation(resultSnapshot(outcome.state.header, outcome.state.meta, items))
  } catch (error) {
    return { ok: false, ...mapError(error) }
  }
}

// --- passphrase and replacement ----------------------------------------------

export async function changePassphrase(
  session: VaultSession,
  context: MutationContext,
  newHeader: VaultHeader,
): Promise<MutationResult> {
  try {
    if (!isVaultHeader(newHeader)) return { ok: false, ...validationFailure('The new vault header is invalid.') }
    if (newHeader.vaultId !== session.header.vaultId) {
      return { ok: false, ...validationFailure('The new vault header belongs to a different library.') }
    }

    const pre = await readDecrypted(session, context, true)
    if (!pre.ok) return { ok: false, ...pre.failure }

    const outcome = await runWrite(async () => {
      const core = await coreWithin()
      const current = core.status === 'ok' ? core.state : null
      if (!current) return { state: null, failure: coreFailure(core) }
      const failure = stateFailure(current, session, context, true)
      if (failure) return { state: null, failure }
      await getDatabase().vault.put({ key: HEADER_KEY, header: newHeader })
      const meta: MetaRecord = { revision: current.meta.revision + 1, generation: current.meta.generation }
      await getDatabase().meta.put({ key: META_KEY, ...meta })
      return { state: { header: newHeader, meta, rows: current.rows }, failure: null }
    })
    const failure = requireCommitted(outcome)
    if (failure || !outcome.state) return { ok: false, ...(failure ?? unavailableFailure()) }
    return completeMutation(resultSnapshot(outcome.state.header, outcome.state.meta, pre.items))
  } catch (error) {
    return { ok: false, ...mapError(error) }
  }
}

export async function replaceLibrary(
  session: VaultSession,
  context: ReplaceLibraryContext,
  records: StoredItem[],
): Promise<MutationResult> {
  try {
    if (!isVaultHeader(session.header)) return { ok: false, ...validationFailure('The vault header is invalid.') }
    if (records.length > APP_LIMITS.maxItems) return { ok: false, ...validationFailure(limitMessage()) }

    const seen = new Set<string>()
    for (const record of records) {
      if (!isStoredRow(record)) return { ok: false, ...validationFailure('The imported records are malformed.') }
      if (record.vaultId !== session.header.vaultId) {
        return { ok: false, ...validationFailure('The imported records belong to a different vault.') }
      }
      if (seen.has(record.id)) return { ok: false, ...validationFailure('The imported records contain duplicate ids.') }
      seen.add(record.id)
    }

    // Decrypt and validate the complete incoming set before any write.
    const decrypted = await decryptRows(session, records)
    if (!decrypted.ok) return { ok: false, ...decrypted.failure }
    const treeErrors = validateTree(decrypted.items)
    if (treeErrors.length > 0) return { ok: false, ...validationFailure(treeErrorMessage(treeErrors)) }

    const initial = context.expectedGeneration === null
    const outcome = await runWrite(async () => {
      const vaultRow = await getDatabase().vault.get(HEADER_KEY)
      const metaRow = await getDatabase().meta.get(META_KEY)
      if (initial) {
        if (vaultRow || metaRow) {
          return { state: null, failure: { code: 'conflict', message: 'A library appeared while importing. Try again.' } }
        }
        const itemCount = await getDatabase().items.count()
        if (itemCount > 0) return { state: null, failure: corruptFailure('Local storage is inconsistent.') }
      } else {
        if (!vaultRow || !metaRow) return { state: null, failure: vaultChangedFailure() }
        if (metaRow.generation !== context.expectedGeneration) return { state: null, failure: vaultChangedFailure() }
        if (metaRow.revision !== context.expectedRevision) return { state: null, failure: conflictFailure() }
      }
      const meta: MetaRecord = initial
        ? { generation: 1, revision: 1 }
        : { generation: context.expectedGeneration + 1, revision: context.expectedRevision + 1 }
      await getDatabase().items.clear()
      if (records.length > 0) await getDatabase().items.bulkPut(records)
      await getDatabase().vault.put({ key: HEADER_KEY, header: session.header })
      await getDatabase().meta.put({ key: META_KEY, ...meta })
      return { state: { header: session.header, meta, rows: records }, failure: null }
    })
    const failure = requireCommitted(outcome)
    if (failure || !outcome.state) return { ok: false, ...(failure ?? unavailableFailure()) }
    return completeMutation(resultSnapshot(outcome.state.header, outcome.state.meta, decrypted.items))
  } catch (error) {
    return { ok: false, ...mapError(error) }
  }
}
