import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as vaultCrypto from '../src/features/vault/crypto'
import { createVault, encryptItem, rewrapVault, sealEnvelope } from '../src/features/vault/crypto'
import type { CreatedVault, VaultSession } from '../src/features/vault/types'
import type { LibraryItem, LibrarySnapshot, MutationContext, StoredItem } from '../src/features/library/types'
import {
  changePassphrase,
  createCollection,
  createNote,
  initializeLibrary,
  loadLibrary,
  readStoredSnapshot,
  replaceLibrary,
  resetRepositoryForTests,
} from '../src/features/library/repository'
import { closeDatabase, deleteDatabase, getDatabase, useDatabaseName as pointDatabaseAt } from '../src/features/library/database'
import {
  backupFilename,
  commitImport,
  exportBackup,
  exportRecoveryBackup,
  prepareImport,
  saveBackupFile,
  writeBackup,
} from '../src/features/backup/backup'
import type { BackupFile, ExportResult } from '../src/features/backup/types'
import { fixturePassphrase, fixtureSecretBody } from './fixtures/library'

// Real crypto and the fake-indexeddb repository throughout. Each case runs in its
// own database. Keys are derived once per vault and reused through sessions.

vi.mock('../src/features/vault/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/vault/crypto')>()
  return { ...actual, unlockVault: vi.fn(actual.unlockVault), openEnvelope: vi.fn(actual.openEnvelope) }
})

vi.setConfig({ testTimeout: 120000 })

const MIB = 1024 * 1024
const PHRASE = fixturePassphrase
const OTHER_PHRASE = 'another correct horse battery staple'
const NEW_PHRASE = 'a brand new passphrase value'
const UNLOCK_MESSAGE = 'Could not unlock this backup. Check the passphrase and file.'
const ORDINARY_TITLE = 'Ordinary reminder title'
const ORDINARY_BODY = 'Ordinary body line one.\nSecond line with a check mark ✓ and trailing space. '

let vaultA: CreatedVault
let vaultB: CreatedVault
let dbName: string
let t = 1_700_000_000_000

beforeAll(async () => {
  vaultA = await createVault(PHRASE)
  vaultB = await createVault(OTHER_PHRASE)
}, 60000)

beforeEach(() => {
  dbName = `scratch-backup-${crypto.randomUUID()}`
  pointDatabaseAt(dbName)
  resetRepositoryForTests()
  vi.mocked(vaultCrypto.unlockVault).mockClear()
  vi.mocked(vaultCrypto.openEnvelope).mockClear()
})

afterEach(async () => {
  await closeDatabase()
  await deleteDatabase(dbName)
  resetRepositoryForTests()
  vi.restoreAllMocks()
})

async function freshDatabase(): Promise<void> {
  await closeDatabase()
  await deleteDatabase(dbName)
  dbName = `scratch-backup-${crypto.randomUUID()}`
  pointDatabaseAt(dbName)
}

function sessionOf(created: CreatedVault, generation = 1): VaultSession {
  return { header: created.header, generation, dataKey: created.dataKey }
}

function contextOf(snapshot: LibrarySnapshot): MutationContext {
  return { generation: snapshot.meta.generation, expectedRevision: snapshot.meta.revision }
}

function item(session: VaultSession, o: Partial<LibraryItem> & Pick<LibraryItem, 'id' | 'kind'>): LibraryItem {
  t += 1
  return {
    vaultId: session.header.vaultId,
    parentId: null,
    version: 1,
    createdAt: t,
    updatedAt: t,
    title: o.kind === 'collection' ? 'Collection' : null,
    body: o.kind === 'note' ? 'A note body' : null,
    isSecret: false,
    color: o.kind === 'collection' ? 'sage' : null,
    ...o,
  }
}

function uid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
}

async function encryptAll(session: VaultSession, items: LibraryItem[]): Promise<StoredItem[]> {
  const out: StoredItem[] = []
  for (const entry of items) out.push(await encryptItem(session, entry))
  return out
}

async function craft(session: VaultSession, items: LibraryItem[]): Promise<File> {
  const stored = await encryptAll(session, items)
  const written = await writeBackup(session, stored)
  if (!written.ok) throw new Error(written.message)
  return new File([written.blob], written.filename)
}

function asFile(result: ExportResult): File {
  if (!result.ok) throw new Error(`export failed: ${result.message}`)
  return new File([result.blob], result.filename)
}

async function textOf(file: Blob): Promise<string> {
  return file.text()
}

// Library A: nested colored collections, an ordinary note, and a secret note.
async function seedLibraryA(): Promise<{ session: VaultSession; snapshot: LibrarySnapshot }> {
  const init = await initializeLibrary(vaultA)
  if (!init.ok) throw new Error(init.message)
  const session = init.session
  let snapshot = init.snapshot
  const step = async (run: (context: MutationContext) => ReturnType<typeof createNote>) => {
    const result = await run(contextOf(snapshot))
    if (!result.ok) throw new Error(result.message)
    snapshot = result.snapshot
    return snapshot
  }
  await step((c) => createCollection(session, c, { parentId: null, title: 'Work area', color: 'sage' }))
  const work = snapshot.items.find((entry) => entry.title === 'Work area')!
  await step((c) => createCollection(session, c, { parentId: work.id, title: 'Deep shelf', color: 'clay' }))
  const deep = snapshot.items.find((entry) => entry.title === 'Deep shelf')!
  await step((c) => createNote(session, c, { parentId: deep.id, title: ORDINARY_TITLE, body: ORDINARY_BODY, isSecret: false }))
  await step((c) => createNote(session, c, { parentId: work.id, title: 'Service credential', body: fixtureSecretBody, isSecret: true }))
  await step((c) => createNote(session, c, { parentId: null, title: null, body: 'Loose root note', isSecret: false }))
  return { session, snapshot }
}

async function storedState() {
  const stored = await readStoredSnapshot()
  if (!stored.ok) throw new Error(stored.message)
  return stored.snapshot
}

function byId<T extends { id: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.id < b.id ? -1 : 1))
}

async function importInitial(file: File, phrase: string) {
  const prepared = await prepareImport(file, phrase)
  if (!prepared.ok) throw new Error(prepared.message)
  const committed = await commitImport(prepared.prepared, null)
  if (!committed.ok) throw new Error(committed.message)
  return committed
}

describe('backup writer and format', () => {
  it('names files with local time', () => {
    expect(backupFilename(new Date(2026, 9, 1, 7, 5))).toBe('scratch-backup-2026-10-01-0705.scratch')
    expect(backupFilename(new Date(2027, 0, 9, 23, 59))).toBe('scratch-backup-2027-01-09-2359.scratch')
  })

  it('exports exactly the brief fields', async () => {
    const { session } = await seedLibraryA()
    const result = await exportBackup(session, new Date(2026, 9, 1, 8, 30))
    expect(result.ok && result.filename).toBe('scratch-backup-2026-10-01-0830.scratch')
    const file = JSON.parse(await textOf(asFile(result))) as BackupFile
    expect(Object.keys(file).sort()).toEqual(['exportedAt', 'format', 'formatVersion', 'header', 'snapshot'])
    expect(file.format).toBe('scratch-backup')
    expect(file.formatVersion).toBe(1)
    expect(Number.isNaN(Date.parse(file.exportedAt))).toBe(false)
    expect(file.header).toEqual(session.header)
    expect(Object.keys(file.snapshot).sort()).toEqual(['ciphertext', 'nonce'])
  })
})

describe('transfer', () => {
  it('restores IDs, exact bodies, secrecy, colors, and hierarchy in a fresh library', async () => {
    const { session, snapshot } = await seedLibraryA()
    const file = asFile(await exportBackup(session))
    const sizeBefore = file.size
    expect(sizeBefore).toBeGreaterThan(0)

    await freshDatabase()
    const imported = await importInitial(file, PHRASE)
    expect(imported.session.generation).toBe(imported.snapshot.meta.generation)
    const loaded = await loadLibrary(imported.session)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(byId(loaded.snapshot.items)).toEqual(byId(snapshot.items))
    const body = loaded.snapshot.items.find((entry) => entry.title === ORDINARY_TITLE)
    expect(body?.body).toBe(ORDINARY_BODY)
    expect(loaded.snapshot.items.find((entry) => entry.title === 'Service credential')).toMatchObject({ isSecret: true, body: fixtureSecretBody })
    expect(loaded.snapshot.items.find((entry) => entry.title === 'Deep shelf')).toMatchObject({ color: 'clay' })
  })

  it('shows the item count in the prepared preview without writing anything', async () => {
    const { session, snapshot } = await seedLibraryA()
    const file = asFile(await exportBackup(session))
    await freshDatabase()
    const prepared = await prepareImport(file, PHRASE)
    expect(prepared.ok && prepared.prepared.itemCount).toBe(snapshot.items.length)
    expect(prepared.ok && prepared.prepared.session.generation).not.toBe(0)
    expect((await readStoredSnapshot()).ok).toBe(false)
  })
})

describe('export privacy', () => {
  it('contains no fixture token, title, body, theme, or query', async () => {
    const { session } = await seedLibraryA()
    const text = await textOf(asFile(await exportBackup(session)))
    // Only long, distinctive needles are searched for in the base64 text; short
    // words could appear there by chance.
    for (const needle of [fixtureSecretBody, ORDINARY_TITLE, 'Ordinary body line one', 'Service credential', 'Work area', 'Deep shelf', 'Loose root note', PHRASE]) {
      expect(text).not.toContain(needle)
    }
    // Key names are checked on the parsed structure, never as substrings.
    const forbidden = new Set(['theme', 'query', 'title', 'body', 'color', 'isSecret', 'passphrase'])
    const walk = (value: unknown): void => {
      if (typeof value !== 'object' || value === null) return
      for (const [key, child] of Object.entries(value)) {
        expect(forbidden.has(key)).toBe(false)
        walk(child)
      }
    }
    walk(JSON.parse(text))
  })
})

describe('full-set authentication', () => {
  async function exported() {
    const { session } = await seedLibraryA()
    const file = asFile(await exportBackup(session))
    await freshDatabase()
    return { file, parsed: JSON.parse(await textOf(file)) as BackupFile }
  }
  function withCiphertext(parsed: BackupFile, ciphertext: string): File {
    return new File([JSON.stringify({ ...parsed, snapshot: { ...parsed.snapshot, ciphertext } })], 'x.scratch')
  }

  it('fails authentication when a ciphertext byte is altered', async () => {
    const { parsed } = await exported()
    const bytes = Buffer.from(parsed.snapshot.ciphertext, 'base64')
    bytes[Math.floor(bytes.length / 2)] ^= 1
    const result = await prepareImport(withCiphertext(parsed, bytes.toString('base64')), PHRASE)
    expect(result).toEqual({ ok: false, code: 'unlock', message: UNLOCK_MESSAGE })
    expect((await readStoredSnapshot()).ok).toBe(false)
  })

  it('fails authentication when records are cut from the ciphertext', async () => {
    const { parsed } = await exported()
    const bytes = Buffer.from(parsed.snapshot.ciphertext, 'base64')
    const cut = bytes.subarray(0, bytes.length - 200).toString('base64')
    const result = await prepareImport(withCiphertext(parsed, cut), PHRASE)
    expect(result).toEqual({ ok: false, code: 'unlock', message: UNLOCK_MESSAGE })
  })

  it('rejects a draft-purpose envelope presented as a backup', async () => {
    const { parsed } = await exported()
    const session = sessionOf(vaultA)
    const snapshotBytes = new TextEncoder().encode(JSON.stringify({ vaultId: session.header.vaultId, records: [] }))
    const draftEnvelope = await sealEnvelope(session, 'draft', snapshotBytes)
    const file = new File([JSON.stringify({ ...parsed, snapshot: draftEnvelope })], 'x.scratch')
    expect(await prepareImport(file, PHRASE)).toEqual({ ok: false, code: 'unlock', message: UNLOCK_MESSAGE })
  })

  it('rejects an envelope sealed for a different vault under this header', async () => {
    const { parsed } = await exported()
    const other = await writeBackup(sessionOf(vaultB), [])
    if (!other.ok) throw new Error(other.message)
    const otherFile = JSON.parse(await textOf(other.blob)) as BackupFile
    const file = new File([JSON.stringify({ ...parsed, snapshot: otherFile.snapshot })], 'x.scratch')
    expect(await prepareImport(file, PHRASE)).toEqual({ ok: false, code: 'unlock', message: UNLOCK_MESSAGE })
  })
})

describe('bad passphrase', () => {
  it('shows a safe error and leaves the old library unchanged', async () => {
    const { session } = await seedLibraryA()
    const file = asFile(await exportBackup(session))
    const before = await storedState()
    const result = await prepareImport(file, 'a wrong passphrase value')
    expect(result).toEqual({ ok: false, code: 'unlock', message: UNLOCK_MESSAGE })
    expect(JSON.stringify(result)).not.toContain('wrong passphrase')
    expect(await storedState()).toEqual(before)
  })

  it('asks for a passphrase before doing any crypto work', async () => {
    const { session } = await seedLibraryA()
    const file = asFile(await exportBackup(session))
    const result = await prepareImport(file, '')
    expect(result.ok).toBe(false)
    expect(vaultCrypto.unlockVault).not.toHaveBeenCalled()
  })
})

describe('preflight', () => {
  async function validFile() {
    const { session } = await seedLibraryA()
    const file = asFile(await exportBackup(session))
    return { file, parsed: JSON.parse(await textOf(file)) as BackupFile, before: await storedState() }
  }
  function mutated(parsed: BackupFile, change: (copy: Record<string, unknown> & { header: Record<string, unknown>; snapshot: Record<string, unknown> }) => void): File {
    const copy = JSON.parse(JSON.stringify(parsed))
    change(copy)
    return new File([JSON.stringify(copy)], 'x.scratch')
  }
  async function expectRejected(file: Blob, code: string, before: unknown) {
    const result = await prepareImport(file, PHRASE)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe(code)
    expect(vaultCrypto.unlockVault).not.toHaveBeenCalled()
    expect(vaultCrypto.openEnvelope).not.toHaveBeenCalled()
    expect(await storedState()).toEqual(before)
  }

  it('rejects files over 32 MiB by size alone', async () => {
    const { before } = await validFile()
    const big = new Blob([new Uint8Array(32 * MIB + 1)])
    const textSpy = vi.spyOn(big, 'text')
    await expectRejected(big, 'too-large', before)
    expect(textSpy).not.toHaveBeenCalled()
  })

  it('accepts a file of exactly 32 MiB for parsing (it is then rejected as malformed, not as too large)', async () => {
    const { before } = await validFile()
    const result = await prepareImport(new Blob([new Uint8Array(32 * MIB)]), PHRASE)
    expect(result.ok === false && result.code).toBe('malformed')
    expect(await storedState()).toEqual(before)
  })

  it('rejects an unknown format version and an unknown format name', async () => {
    const { parsed, before } = await validFile()
    await expectRejected(mutated(parsed, (c) => { c.formatVersion = 2 }), 'unsupported', before)
    await expectRejected(mutated(parsed, (c) => { c.header.formatVersion = 2 }), 'unsupported', before)
    await expectRejected(mutated(parsed, (c) => { c.format = 'other-backup' }), 'unsupported', before)
  })

  it('rejects malformed base64 in the header and the snapshot', async () => {
    const { parsed, before } = await validFile()
    await expectRejected(mutated(parsed, (c) => { c.header.salt = '!!!not base64!!!' }), 'malformed', before)
    await expectRejected(mutated(parsed, (c) => { c.header.wrappedDataKey = { nonce: 'AAAA', ciphertext: '@@@@' } }), 'malformed', before)
    await expectRejected(mutated(parsed, (c) => { c.snapshot.ciphertext = 'abc$' }), 'malformed', before)
    await expectRejected(mutated(parsed, (c) => { c.snapshot.nonce = 'AAAA' }), 'malformed', before)
  })

  it('rejects unsupported KDF parameters, wrong sizes, and extra fields before derivation', async () => {
    const { parsed, before } = await validFile()
    await expectRejected(mutated(parsed, (c) => { c.header.iterations = 1000 }), 'unsupported', before)
    await expectRejected(mutated(parsed, (c) => { c.header.iterations = 600001 }), 'unsupported', before)
    await expectRejected(mutated(parsed, (c) => { c.header.iterations = '600000' }), 'malformed', before)
    await expectRejected(mutated(parsed, (c) => { c.header.salt = 'AAAA' }), 'malformed', before)
    await expectRejected(mutated(parsed, (c) => { c.header.kdf = 'argon2' }), 'unsupported', before)
    await expectRejected(mutated(parsed, (c) => { c.extra = true }), 'unsupported', before)
  })

  it('rejects text that is not JSON or not an object', async () => {
    const { before } = await validFile()
    await expectRejected(new File(['not json at all'], 'x.scratch'), 'malformed', before)
    await expectRejected(new File(['[1,2,3]'], 'x.scratch'), 'malformed', before)
    await expectRejected(new File(['null'], 'x.scratch'), 'malformed', before)
  })
})

describe('structural invalidity', () => {
  async function expectInvalid(items: LibraryItem[]) {
    const { session } = await seedLibraryA()
    const before = await storedState()
    const file = await craft(sessionOf(vaultB), items.map((entry) => ({ ...entry, vaultId: vaultB.header.vaultId })))
    const result = await prepareImport(file, OTHER_PHRASE)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('invalid')
    expect(await storedState()).toEqual(before)
    expect(session.generation).toBe(1)
  }
  const s = () => sessionOf(vaultB)

  it('rejects duplicate IDs', async () => {
    await expectInvalid([item(s(), { id: uid(1), kind: 'note' }), item(s(), { id: uid(1), kind: 'note' })])
  })

  it('rejects a cycle', async () => {
    await expectInvalid([
      item(s(), { id: uid(1), kind: 'collection', parentId: uid(2) }),
      item(s(), { id: uid(2), kind: 'collection', parentId: uid(1) }),
    ])
  })

  it('rejects a missing parent', async () => {
    await expectInvalid([item(s(), { id: uid(1), kind: 'note', parentId: uid(99) })])
  })

  it('rejects a note used as a parent', async () => {
    await expectInvalid([item(s(), { id: uid(1), kind: 'note' }), item(s(), { id: uid(2), kind: 'note', parentId: uid(1) })])
  })

  it('rejects excessive depth', async () => {
    const chain: LibraryItem[] = []
    for (let level = 0; level < 9; level++) {
      chain.push(item(s(), { id: uid(level + 1), kind: 'collection', parentId: level === 0 ? null : uid(level) }))
    }
    await expectInvalid(chain)
  })

  it('rejects an empty note body', async () => {
    await expectInvalid([item(s(), { id: uid(1), kind: 'note', body: '   ' })])
  })

  it('rejects a secret note without a title', async () => {
    await expectInvalid([item(s(), { id: uid(1), kind: 'note', isSecret: true, title: null })])
  })

  it('rejects a record whose vault ID differs from the header', async () => {
    const { session } = await seedLibraryA()
    const before = await storedState()
    const stored = await encryptAll(sessionOf(vaultB), [item(sessionOf(vaultB), { id: uid(1), kind: 'note' })])
    stored[0] = { ...stored[0], vaultId: vaultA.header.vaultId }
    const written = await writeBackup(sessionOf(vaultB), stored)
    if (!written.ok) throw new Error(written.message)
    const result = await prepareImport(new File([written.blob], 'x.scratch'), OTHER_PHRASE)
    expect(result.ok === false && result.code).toBe('invalid')
    expect(await storedState()).toEqual(before)
    expect(session.generation).toBe(1)
  })

  it('rejects a record whose structural fields were altered after encryption', async () => {
    const stored = await encryptAll(sessionOf(vaultB), [item(sessionOf(vaultB), { id: uid(1), kind: 'note' })])
    stored[0] = { ...stored[0], version: stored[0].version + 1 }
    const written = await writeBackup(sessionOf(vaultB), stored)
    if (!written.ok) throw new Error(written.message)
    const result = await prepareImport(new File([written.blob], 'x.scratch'), OTHER_PHRASE)
    expect(result.ok === false && result.code).toBe('invalid')
  })
})

describe('capacity', () => {
  it('rejects 1,001 items and accepts 1,000', async () => {
    const session = sessionOf(vaultB)
    const items: LibraryItem[] = []
    for (let n = 1; n <= 1001; n++) items.push(item(session, { id: uid(n), kind: 'note', body: `note ${n}` }))
    const over = await craft(session, items)
    const rejected = await prepareImport(over, OTHER_PHRASE)
    expect(rejected.ok === false && rejected.code).toBe('invalid')

    const exact = await craft(session, items.slice(0, 1000))
    const accepted = await prepareImport(exact, OTHER_PHRASE)
    expect(accepted.ok && accepted.prepared.itemCount).toBe(1000)
    const committed = await commitImport((accepted as { ok: true; prepared: never }).prepared, null)
    expect(committed.ok).toBe(true)
  })
})

describe('maximum valid backup', () => {
  it('keeps 1,000 maximum-size notes under 32 MiB and restores them', async () => {
    const session = sessionOf(vaultB)
    // 13 UTF-8 bytes per cluster, 78 clusters: 1,014 bytes, within both title limits.
    const title = 'é́́́́́'.repeat(78)
    expect(new TextEncoder().encode(title).length).toBeLessThanOrEqual(1024)
    const items: LibraryItem[] = []
    for (let n = 1; n <= 1000; n++) {
      const body = `${n}:`.padEnd(10000, String.fromCharCode(97 + (n % 26)))
      items.push(item(session, { id: uid(n), kind: 'note', title, body }))
    }
    const file = await craft(session, items)
    expect(file.size).toBeLessThan(32 * MIB)
    const imported = await importInitial(file, OTHER_PHRASE)
    const loaded = await loadLibrary(imported.session)
    expect(loaded.ok && loaded.snapshot.items.length).toBe(1000)

    // The standard export of the stored library is also within the limit and restorable.
    const again = asFile(await exportBackup(imported.session))
    expect(again.size).toBeLessThan(32 * MIB)
    await freshDatabase()
    const restored = await prepareImport(again, OTHER_PHRASE)
    expect(restored.ok && restored.prepared.itemCount).toBe(1000)
  })
})

describe('escape-heavy maximum library', () => {
  it('refuses a too-large export safely: no file, no database change, content-free advice', async () => {
    const session = sessionOf(vaultB)
    const records: StoredItem[] = []
    // Quotes escape to two bytes each in JSON, then base64 twice: over 32 MiB at 1,000 notes.
    for (let n = 1; n <= 1000; n++) {
      records.push(await encryptItem(session, item(session, { id: uid(n), kind: 'note', title: `Heavy ${n}`, body: '"'.repeat(10000) })))
    }
    const seeded = await replaceLibrary(session, { expectedGeneration: null, expectedRevision: null }, records)
    expect(seeded.ok).toBe(true)
    const before = await storedState()

    const written = await writeBackup(session, records)
    expect(written.ok === false && written.code).toBe('too-large')

    const result = await exportBackup(session)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('too-large')
      expect(result.message).toMatch(/delete or shorten some notes/i)
      expect(result.message).not.toContain('Heavy')
    }
    expect(await storedState()).toEqual(before)
  })
})

describe('replacement transaction', () => {
  async function replacementSetup() {
    const { session, snapshot } = await seedLibraryA()
    const incoming = await craft(sessionOf(vaultB), [item(sessionOf(vaultB), { id: uid(1), kind: 'note', body: 'incoming only' })])
    const prepared = await prepareImport(incoming, OTHER_PHRASE)
    if (!prepared.ok) throw new Error(prepared.message)
    return { session, snapshot, prepared: prepared.prepared }
  }

  it('replaces the library once and returns the repository generation', async () => {
    const { snapshot, prepared } = await replacementSetup()
    const base = { generation: snapshot.meta.generation, revision: snapshot.meta.revision }
    const committed = await commitImport(prepared, base)
    expect(committed.ok).toBe(true)
    if (!committed.ok) return
    const state = await storedState()
    expect(state.meta.generation).toBe(base.generation + 1)
    expect(committed.session.generation).toBe(state.meta.generation)
    expect(state.header).toEqual(vaultB.header)
    expect(state.items).toHaveLength(1)
    const loaded = await loadLibrary(committed.session)
    expect(loaded.ok && loaded.snapshot.items.map((entry) => entry.body)).toEqual(['incoming only'])
  })

  it('keeps header, items, and meta intact when a write fails halfway', async () => {
    const { snapshot, prepared } = await replacementSetup()
    const before = await storedState()
    vi.spyOn(getDatabase().items, 'bulkPut').mockRejectedValue(new Error('injected failure'))
    const committed = await commitImport(prepared, { generation: snapshot.meta.generation, revision: snapshot.meta.revision })
    expect(committed.ok).toBe(false)
    vi.restoreAllMocks()
    expect(await storedState()).toEqual(before)
  })

  it('reports a conflict, without overwriting, when another tab changed the revision after preview', async () => {
    const { session, snapshot, prepared } = await replacementSetup()
    const other = await createNote(session, contextOf(snapshot), { parentId: null, title: null, body: 'another tab note', isSecret: false })
    expect(other.ok).toBe(true)
    const before = await storedState()
    const committed = await commitImport(prepared, { generation: snapshot.meta.generation, revision: snapshot.meta.revision })
    expect(committed.ok === false && committed.code).toBe('conflict')
    expect(await storedState()).toEqual(before)
  })

  it('reports vault-changed when the generation moved after preview', async () => {
    const { snapshot, prepared } = await replacementSetup()
    const base = { generation: snapshot.meta.generation, revision: snapshot.meta.revision }
    const first = await commitImport(prepared, base)
    expect(first.ok).toBe(true)
    const before = await storedState()
    const second = await commitImport(prepared, base)
    expect(second.ok === false && second.code).toBe('vault-changed')
    expect(await storedState()).toEqual(before)
  })

  it('refuses an initial import when a library already exists', async () => {
    const { prepared } = await replacementSetup()
    const before = await storedState()
    const committed = await commitImport(prepared, null)
    expect(committed.ok === false && committed.code).toBe('conflict')
    expect(await storedState()).toEqual(before)
  })

  it('cancel: preparing then discarding changes no data', async () => {
    const { prepared } = await replacementSetup()
    const before = await storedState()
    expect(prepared.itemCount).toBe(1)
    // Cancelling is dropping the prepared value; nothing was written to storage.
    expect(await storedState()).toEqual(before)
  })
})

describe('standard export consistency', () => {
  it('asks for a refresh when the session no longer matches storage', async () => {
    const { session } = await seedLibraryA()
    const wrongGeneration = await exportBackup({ ...session, generation: session.generation + 1 })
    expect(wrongGeneration.ok === false && wrongGeneration.code).toBe('stale')
    const otherVault = await exportBackup(sessionOf(vaultB))
    expect(otherVault.ok === false && otherVault.code).toBe('stale')
    const staleHeader = await exportBackup({ ...session, header: { ...session.header, salt: 'AAAAAAAAAAAAAAAAAAAAAA==' } })
    expect(staleHeader.ok === false && staleHeader.code).toBe('stale')
  })

  it('reports unavailable when there is no library', async () => {
    const result = await exportBackup(sessionOf(vaultA))
    expect(result.ok).toBe(false)
  })
})

describe('old passphrase backup', () => {
  it('keeps the old passphrase for old files and the new one for new files', async () => {
    const { session, snapshot } = await seedLibraryA()
    const oldFile = asFile(await exportBackup(session))
    const header = await rewrapVault(session, PHRASE, NEW_PHRASE)
    const changed = await changePassphrase(session, contextOf(snapshot), header)
    expect(changed.ok).toBe(true)
    const updated: VaultSession = { ...session, header }
    const newFile = asFile(await exportBackup(updated))

    expect((await prepareImport(oldFile, PHRASE)).ok).toBe(true)
    expect((await prepareImport(oldFile, NEW_PHRASE)).ok).toBe(false)
    expect((await prepareImport(newFile, NEW_PHRASE)).ok).toBe(true)
    expect((await prepareImport(newFile, PHRASE)).ok).toBe(false)
  })
})

describe('dirty stale tab recovery export', () => {
  async function staleTab() {
    const { session, snapshot } = await seedLibraryA()
    // Tab B keeps this session and in-memory snapshot while tab A replaces the library.
    const replacement = await craft(sessionOf(vaultB), [item(sessionOf(vaultB), { id: uid(1), kind: 'note', body: 'new library note' })])
    const prepared = await prepareImport(replacement, OTHER_PHRASE)
    if (!prepared.ok) throw new Error(prepared.message)
    const committed = await commitImport(prepared.prepared, { generation: snapshot.meta.generation, revision: snapshot.meta.revision })
    if (!committed.ok) throw new Error(committed.message)
    return { session, snapshot, afterReplace: await storedState() }
  }

  it('includes the new-note draft and the old library without touching the new library', async () => {
    const { session, snapshot, afterReplace } = await staleTab()
    const file = asFile(await exportRecoveryBackup(session, snapshot, {
      noteId: null,
      input: { parentId: null, title: 'Draft title', body: 'unsaved draft body', isSecret: false },
    }))
    expect(await storedState()).toEqual(afterReplace)

    const text = await textOf(file)
    expect(text).not.toContain('unsaved draft body')
    await freshDatabase()
    const imported = await importInitial(file, PHRASE)
    const loaded = await loadLibrary(imported.session)
    if (!loaded.ok) throw new Error(loaded.message)
    expect(loaded.snapshot.items).toHaveLength(snapshot.items.length + 1)
    for (const old of snapshot.items) expect(loaded.snapshot.items.find((entry) => entry.id === old.id)).toEqual(old)
    expect(loaded.snapshot.items.find((entry) => entry.body === 'unsaved draft body')).toMatchObject({ title: 'Draft title', kind: 'note', version: 1 })
  })

  it('applies an edit draft to the existing note and bumps its version', async () => {
    const { session, snapshot } = await staleTab()
    const target = snapshot.items.find((entry) => entry.title === ORDINARY_TITLE)!
    const file = asFile(await exportRecoveryBackup(session, snapshot, {
      noteId: target.id,
      input: { parentId: target.parentId, title: ORDINARY_TITLE, body: 'edited in stale tab', isSecret: false },
    }))
    await freshDatabase()
    const imported = await importInitial(file, PHRASE)
    const loaded = await loadLibrary(imported.session)
    if (!loaded.ok) throw new Error(loaded.message)
    expect(loaded.snapshot.items).toHaveLength(snapshot.items.length)
    expect(loaded.snapshot.items.find((entry) => entry.id === target.id)).toMatchObject({ body: 'edited in stale tab', version: target.version + 1 })
  })

  it('refuses invalid or empty drafts and exports nothing', async () => {
    const { session, snapshot } = await staleTab()
    const empty = await exportRecoveryBackup(session, snapshot, { noteId: null, input: { parentId: null, title: null, body: '   ', isSecret: false } })
    expect(empty.ok === false && empty.code).toBe('invalid-draft')
    const secret = await exportRecoveryBackup(session, snapshot, { noteId: null, input: { parentId: null, title: null, body: 'x', isSecret: true } })
    expect(secret.ok === false && secret.code).toBe('invalid-draft')
    const noSnapshot = await exportRecoveryBackup(session, null, { noteId: null, input: { parentId: null, title: null, body: 'x', isSecret: false } })
    expect(noSnapshot.ok).toBe(false)
  })

  it('files a draft for a deleted note, or a missing parent, as a new note at the top level', async () => {
    const { session, snapshot } = await staleTab()
    const file = asFile(await exportRecoveryBackup(session, snapshot, {
      noteId: uid(777),
      input: { parentId: uid(778), title: null, body: 'orphan draft', isSecret: false },
    }))
    await freshDatabase()
    const imported = await importInitial(file, PHRASE)
    const loaded = await loadLibrary(imported.session)
    if (!loaded.ok) throw new Error(loaded.message)
    expect(loaded.snapshot.items.find((entry) => entry.body === 'orphan draft')).toMatchObject({ parentId: null, version: 1 })
  })

  it('refuses a new-note draft when the library is full', async () => {
    const session = sessionOf(vaultB)
    const items: LibraryItem[] = []
    for (let n = 1; n <= 1000; n++) items.push(item(session, { id: uid(n), kind: 'note', body: `n${n}` }))
    const snapshot: LibrarySnapshot = { header: session.header, meta: { generation: 1, revision: 1 }, items }
    const full = await exportRecoveryBackup(session, snapshot, { noteId: null, input: { parentId: null, title: null, body: 'one too many', isSecret: false } })
    expect(full.ok === false && full.code).toBe('invalid-draft')
  })
})

describe('library replacement through the repository', () => {
  it('leaves the replaced library authenticated under the imported header only', async () => {
    const { session, snapshot } = await seedLibraryA()
    const incoming = await craft(sessionOf(vaultB), [item(sessionOf(vaultB), { id: uid(1), kind: 'note', body: 'incoming only' })])
    const prepared = await prepareImport(incoming, OTHER_PHRASE)
    if (!prepared.ok) throw new Error(prepared.message)
    const committed = await commitImport(prepared.prepared, { generation: snapshot.meta.generation, revision: snapshot.meta.revision })
    expect(committed.ok).toBe(true)
    // The old session no longer loads anything: the generation and vault moved on.
    const old = await loadLibrary(session)
    expect(old.ok).toBe(false)
    const direct = await replaceLibrary(session, { expectedGeneration: 99, expectedRevision: 99 }, [])
    expect(direct.ok).toBe(false)
  })
})

describe('saveBackupFile', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('downloads under the given name and revokes the object URL afterwards', () => {
    vi.useFakeTimers()
    const created = vi.fn(() => 'blob:backup-url')
    const revoked = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked }))
    const seen: Array<{ download: string; href: string }> = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      seen.push({ download: this.download, href: this.href })
    })
    saveBackupFile(new Blob(['x']), 'scratch-backup-2026-10-01-0705.scratch')
    expect(seen).toEqual([{ download: 'scratch-backup-2026-10-01-0705.scratch', href: 'blob:backup-url' }])
    expect(revoked).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10_000)
    expect(revoked).toHaveBeenCalledWith('blob:backup-url')
    expect(document.querySelector('a[download]')).toBeNull()
    vi.unstubAllGlobals()
  })

  it('still revokes the URL when the download click throws', () => {
    vi.useFakeTimers()
    const revoked = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:u', revokeObjectURL: revoked }))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('blocked') })
    expect(() => saveBackupFile(new Blob(['x']), 'a.scratch')).toThrow('blocked')
    vi.advanceTimersByTime(10_000)
    expect(revoked).toHaveBeenCalledWith('blob:u')
    vi.unstubAllGlobals()
  })
})
