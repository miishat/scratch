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

// --- public result shapes ----------------------------------------------------

export interface StoredHeader {
  header: VaultHeader
  meta: MetaRecord
}

export type ReadHeaderResult =
  | { ok: true; header: StoredHeader | null }
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

function isEnvelope(value: unknown): value is CipherEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const envelope = value as Record<string, unknown>
  return typeof envelope.nonce === 'string' && typeof envelope.ciphertext === 'string' && envelope.nonce.length > 0 && envelope.ciphertext.length > 0
}

function isVaultHeader(value: unknown): value is VaultHeader {
  if (typeof value !== 'object' || value === null) return false
  const header = value as Record<string, unknown>
  return (
    typeof header.formatVersion === 'number' &&
    typeof header.vaultId === 'string' &&
    header.vaultId.length > 0 &&
    typeof header.salt === 'string' &&
    typeof header.iterations === 'number' &&
    isEnvelope(header.wrappedDataKey)
  )
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

async function snapshotFromStored(
  session: VaultSession,
  header: VaultHeader,
  meta: MetaRecord,
  rows: StoredItem[],
  checkTree: boolean,
): Promise<MutationResult> {
  const decrypted = await decryptRows(session, rows)
  if (!decrypted.ok) return { ok: false, ...decrypted.failure }
  if (checkTree) {
    const errors = validateTree(decrypted.items)
    if (errors.length > 0) return { ok: false, code: 'corrupt', message: 'The stored library is not a valid tree.' }
  }
  return { ok: true, snapshot: { header, meta, items: sortItems(decrypted.items) } }
}

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

// --- header / load / raw snapshot --------------------------------------------

export async function readHeader(): Promise<ReadHeaderResult> {
  try {
    const core = await readCore()
    if (core.status === 'empty') return { ok: true, header: null }
    if (core.status === 'corrupt') return { ok: false, ...corruptFailure(core.message) }
    return { ok: true, header: { header: core.state.header, meta: core.state.meta } }
  } catch (error) {
    return { ok: false, ...mapError(error) }
  }
}

export async function loadLibrary(session: VaultSession): Promise<MutationResult> {
  try {
    const core = await readCore()
    if (core.status === 'empty') return { ok: false, ...corruptFailure('No library is stored here.') }
    if (core.status === 'corrupt') return { ok: false, ...corruptFailure(core.message) }
    if (core.state.header.vaultId !== session.header.vaultId) return { ok: false, ...vaultChangedFailure() }
    if (core.state.meta.generation !== session.generation) return { ok: false, ...vaultChangedFailure() }
    return await snapshotFromStored(session, core.state.header, core.state.meta, core.state.rows, true)
  } catch (error) {
    return { ok: false, ...mapError(error) }
  }
}

export async function readStoredSnapshot(): Promise<ReadStoredSnapshotResult> {
  try {
    const core = await readCore()
    if (core.status === 'empty') return { ok: false, ...unavailableFailure() }
    if (core.status === 'corrupt') return { ok: false, ...corruptFailure(core.message) }
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
    if (outcome.failure || !outcome.state) return { ok: false, ...(outcome.failure ?? unavailableFailure()) }
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
      const rows = await getDatabase().items.toArray()
      return { state: { header: current.header, meta, rows }, failure: null }
    })
    if (outcome.failure || !outcome.state) return { ok: false, ...(outcome.failure ?? unavailableFailure()) }
    return await completeMutation(await snapshotFromStored(session, outcome.state.header, outcome.state.meta, outcome.state.rows, false))
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
      const rows = await getDatabase().items.toArray()
      return { state: { header: current.header, meta, rows }, failure: null }
    })
    if (outcome.failure || !outcome.state) return { ok: false, ...(outcome.failure ?? unavailableFailure()) }
    return await completeMutation(await snapshotFromStored(session, outcome.state.header, outcome.state.meta, outcome.state.rows, false))
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

    const core = await readCore()
    const current = core.status === 'ok' ? core.state : null
    if (!current) return { ok: false, ...coreFailure(core) }
    const failure = stateFailure(current, session, context, true)
    if (failure) return { ok: false, ...failure }
    const row = current.rows.find((candidate) => candidate.id === id)
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
      const rows = await getDatabase().items.toArray()
      return { state: { header: latest.header, meta, rows }, failure: null }
    })
    if (outcome.failure || !outcome.state) return { ok: false, ...(outcome.failure ?? unavailableFailure()) }
    return await completeMutation(await snapshotFromStored(session, outcome.state.header, outcome.state.meta, outcome.state.rows, false))
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

    const core = await readCore()
    const current = core.status === 'ok' ? core.state : null
    if (!current) return { ok: false, ...coreFailure(core) }
    const failure = stateFailure(current, session, context, true)
    if (failure) return { ok: false, ...failure }
    const row = current.rows.find((candidate) => candidate.id === id)
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
      const rows = await getDatabase().items.toArray()
      return { state: { header: latest.header, meta, rows }, failure: null }
    })
    if (outcome.failure || !outcome.state) return { ok: false, ...(outcome.failure ?? unavailableFailure()) }
    return await completeMutation(await snapshotFromStored(session, outcome.state.header, outcome.state.meta, outcome.state.rows, false))
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

    const core = await readCore()
    const current = core.status === 'ok' ? core.state : null
    if (!current) return { ok: false, ...coreFailure(core) }
    const failure = stateFailure(current, session, context, false)
    if (failure) return { ok: false, ...failure }
    const decrypted = await decryptRows(session, current.rows)
    if (!decrypted.ok) return { ok: false, ...decrypted.failure }
    const items = decrypted.items
    const item = items.find((candidate) => candidate.id === id)
    if (!item) return { ok: false, ...validationFailure('That item no longer exists.') }
    if (item.version !== version) return { ok: false, ...conflictFailure() }

    // A move to the current parent is a real no-op: report the current snapshot
    // without bumping the revision or re-encrypting anything.
    if (item.parentId === newParentId) {
      return { ok: true, snapshot: { header: current.header, meta: current.meta, items: sortItems(items) } }
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
      const rows = await getDatabase().items.toArray()
      return { state: { header: latest.header, meta, rows }, failure: null }
    })
    if (outcome.failure || !outcome.state) return { ok: false, ...(outcome.failure ?? unavailableFailure()) }
    return await completeMutation(await snapshotFromStored(session, outcome.state.header, outcome.state.meta, outcome.state.rows, false))
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

    const core = await readCore()
    const current = core.status === 'ok' ? core.state : null
    if (!current) return { ok: false, ...coreFailure(core) }
    const failure = stateFailure(current, session, context, true)
    if (failure) return { ok: false, ...failure }
    const structural = current.rows.map(structuralItem)
    const target = structural.find((item) => item.id === id)
    if (!target) return { ok: false, ...validationFailure('That item no longer exists.') }
    if (target.version !== version) return { ok: false, ...conflictFailure() }
    const subtree = [id, ...descendantsOf(structural, id)]
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
      const rows = await getDatabase().items.toArray()
      return { state: { header: latest.header, meta, rows }, failure: null }
    })
    if (outcome.failure || !outcome.state) return { ok: false, ...(outcome.failure ?? unavailableFailure()) }
    return await completeMutation(await snapshotFromStored(session, outcome.state.header, outcome.state.meta, outcome.state.rows, false))
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
    const outcome = await runWrite(async () => {
      const core = await coreWithin()
      const current = core.status === 'ok' ? core.state : null
      if (!current) return { state: null, failure: coreFailure(core) }
      const failure = stateFailure(current, session, context, true)
      if (failure) return { state: null, failure }
      await getDatabase().vault.put({ key: HEADER_KEY, header: newHeader })
      const meta: MetaRecord = { revision: current.meta.revision + 1, generation: current.meta.generation }
      await getDatabase().meta.put({ key: META_KEY, ...meta })
      const rows = await getDatabase().items.toArray()
      return { state: { header: newHeader, meta, rows }, failure: null }
    })
    if (outcome.failure || !outcome.state) return { ok: false, ...(outcome.failure ?? unavailableFailure()) }
    return await completeMutation(await snapshotFromStored(session, outcome.state.header, outcome.state.meta, outcome.state.rows, false))
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
    if (outcome.failure || !outcome.state) return { ok: false, ...(outcome.failure ?? unavailableFailure()) }
    return await completeMutation({
      ok: true,
      snapshot: { header: session.header, meta: outcome.state.meta, items: sortItems(decrypted.items) },
    })
  } catch (error) {
    return { ok: false, ...mapError(error) }
  }
}
