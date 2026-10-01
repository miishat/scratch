import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createVault, encryptItem, rewrapVault, unlockVault } from '../src/features/vault/crypto'
import type { CreatedVault, VaultHeader, VaultSession } from '../src/features/vault/types'
import type {
  LibraryItem,
  LibrarySnapshot,
  MetaRecord,
  MutationContext,
  StoredItem,
} from '../src/features/library/types'
import { fixturePassphrase, fixtureSecretBody } from './fixtures/library'
import {
  changePassphrase,
  createCollection,
  createNote,
  deleteItem,
  getPersistenceState,
  initializeLibrary,
  loadLibrary,
  moveItem,
  readHeader,
  readStoredSnapshot,
  replaceLibrary,
  resetRepositoryForTests,
  updateNote,
} from '../src/features/library/repository'
import { closeDatabase, deleteDatabase, getDatabase, useDatabaseName } from '../src/features/library/database'
import { publishChange, subscribeToChanges, type ChangeNotification } from '../src/features/library/changes'

const NEW_PASSPHRASE = 'a brand new passphrase value'

let vaultA: CreatedVault
let vaultB: CreatedVault
let dbName: string

beforeAll(async () => {
  vaultA = await createVault(fixturePassphrase)
  vaultB = await createVault('another correct horse battery staple')
}, 60000)

beforeEach(() => {
  dbName = `scratch-test-${crypto.randomUUID()}`
  useDatabaseName(dbName)
  resetRepositoryForTests()
})

afterEach(async () => {
  await closeDatabase()
  await deleteDatabase(dbName)
  resetRepositoryForTests()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function sessionOf(created: CreatedVault, generation = 1): VaultSession {
  return { header: created.header, generation, dataKey: created.dataKey }
}

function contextOf(snapshot: { meta: MetaRecord }): MutationContext {
  return { generation: snapshot.meta.generation, expectedRevision: snapshot.meta.revision }
}

async function setup(): Promise<{ session: VaultSession; snapshot: LibrarySnapshot }> {
  const result = await initializeLibrary(vaultA)
  if (!result.ok) throw new Error(`initialize failed: ${result.message}`)
  return { session: result.session, snapshot: result.snapshot }
}

function noteInput(body: string, overrides: Partial<{ title: string | null; parentId: string | null; isSecret: boolean }> = {}) {
  return {
    parentId: overrides.parentId ?? null,
    title: overrides.title ?? null,
    body,
    isSecret: overrides.isSecret ?? false,
  }
}

function importedNote(vaultId: string, body: string): LibraryItem {
  const time = 1_700_000_000_000
  return {
    id: crypto.randomUUID(),
    vaultId,
    parentId: null,
    kind: 'note',
    version: 1,
    createdAt: time,
    updatedAt: time,
    title: null,
    body,
    isSecret: false,
    color: null,
  }
}

function rawStore(storeName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName)
    request.onerror = () => reject(request.error ?? new Error('open failed'))
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction(storeName, 'readonly')
      const getAll = transaction.objectStore(storeName).getAll()
      getAll.onerror = () => {
        database.close()
        reject(getAll.error ?? new Error('read failed'))
      }
      getAll.onsuccess = () => {
        database.close()
        resolve(JSON.stringify(getAll.result))
      }
    }
  })
}

function tamper(ciphertext: string): string {
  const binary = atob(ciphertext)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  bytes[0] ^= 0x01
  let result = ''
  for (let i = 0; i < bytes.length; i++) result += String.fromCharCode(bytes[i])
  return btoa(result)
}

describe('repository persistence and encryption at rest', () => {
  it('persists encrypted data across a close and reopen', async () => {
    const { session, snapshot } = await setup()
    const created = await createNote(session, contextOf(snapshot), noteInput('first body', { title: 'Persisted' }))
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error(created.message)
    const note = created.snapshot.items[0]

    const updated = await updateNote(
      session,
      { ...contextOf(created.snapshot), expectedVersion: note.version },
      note.id,
      noteInput('updated body after reload', { title: 'Persisted' }),
    )
    expect(updated.ok).toBe(true)

    await closeDatabase()

    const header = await readHeader()
    if (!header.ok || header.library !== 'present') throw new Error('no header after reopen')
    const unlocked = await unlockVault(header.header.header, fixturePassphrase, header.header.meta.generation)
    expect(unlocked.ok).toBe(true)
    if (!unlocked.ok) throw new Error(unlocked.message)

    const loaded = await loadLibrary(unlocked.session)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) throw new Error(loaded.message)
    const reloaded = loaded.snapshot.items.find((item) => item.id === note.id)
    expect(reloaded?.title).toBe('Persisted')
    expect(reloaded?.body).toBe('updated body after reload')
  }, 30000)

  it('stores neither note titles nor bodies in plaintext', async () => {
    const { session, snapshot } = await setup()
    const secretBody = `${fixtureSecretBody}-${crypto.randomUUID()}`
    const secretTitle = `Secret Title ${crypto.randomUUID()}`
    const collectionTitle = `Collection Name ${crypto.randomUUID()}`
    const ordinaryBody = `ordinary body ${crypto.randomUUID()}`

    const first = await createNote(session, contextOf(snapshot), {
      parentId: null,
      title: secretTitle,
      body: secretBody,
      isSecret: true,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.message)

    const second = await createCollection(session, contextOf(first.snapshot), {
      parentId: null,
      title: collectionTitle,
      color: 'sage',
    })
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error(second.message)

    const third = await createNote(session, contextOf(second.snapshot), noteInput(ordinaryBody))
    expect(third.ok).toBe(true)

    const itemsRaw = await rawStore('items')
    expect(itemsRaw).toContain('ciphertext')
    expect(itemsRaw).not.toContain(secretBody)
    expect(itemsRaw).not.toContain(secretTitle)
    expect(itemsRaw).not.toContain(collectionTitle)
    expect(itemsRaw).not.toContain(ordinaryBody)
    expect(await rawStore('vault')).not.toContain(secretBody)
    expect(await rawStore('meta')).not.toContain(secretBody)
  })
})

describe('repository atomicity', () => {
  it('rolls back every change when a write fails mid-transaction', async () => {
    const { session, snapshot } = await setup()
    const created = await createNote(session, contextOf(snapshot), noteInput('kept body', { title: 'Kept' }))
    if (!created.ok) throw new Error(created.message)

    const before = await readStoredSnapshot()
    expect(before.ok).toBe(true)
    if (!before.ok) throw new Error(before.message)
    const beforeJson = JSON.stringify(before.snapshot)

    const records: StoredItem[] = []
    for (let index = 0; index < 3; index++) {
      records.push(await encryptItem(session, importedNote(vaultA.header.vaultId, `replacement ${index}`)))
    }

    const db = getDatabase()
    let creations = 0
    const hook = () => {
      creations += 1
      if (creations === 2) throw new Error('injected transaction failure')
    }
    db.items.hook('creating', hook)
    try {
      const result = await replaceLibrary(
        session,
        { expectedGeneration: 1, expectedRevision: before.snapshot.meta.revision },
        records,
      )
      expect(result.ok).toBe(false)
    } finally {
      db.items.hook('creating').unsubscribe(hook)
    }
    expect(creations).toBeGreaterThanOrEqual(2)

    const after = await readStoredSnapshot()
    expect(after.ok).toBe(true)
    if (!after.ok) throw new Error(after.message)
    expect(JSON.stringify(after.snapshot)).toBe(beforeJson)
  })

  it('maps a quota failure to quota with no partial write', async () => {
    const { session, snapshot } = await setup()
    const created = await createNote(session, contextOf(snapshot), noteInput('quota base'))
    if (!created.ok) throw new Error(created.message)

    const before = await readStoredSnapshot()
    if (!before.ok) throw new Error(before.message)
    const beforeJson = JSON.stringify(before.snapshot)

    const db = getDatabase()
    const hook = () => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    }
    db.items.hook('creating', hook)
    try {
      const result = await createNote(session, contextOf(before.snapshot), noteInput('will not persist'))
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unexpected success')
      expect(result.code).toBe('quota')
    } finally {
      db.items.hook('creating').unsubscribe(hook)
    }

    const after = await readStoredSnapshot()
    if (!after.ok) throw new Error(after.message)
    expect(JSON.stringify(after.snapshot)).toBe(beforeJson)
  })

  it('reports corrupt when a stored record cannot be authenticated', async () => {
    const { session, snapshot } = await setup()
    const created = await createNote(session, contextOf(snapshot), noteInput('tamper target'))
    if (!created.ok) throw new Error(created.message)
    const note = created.snapshot.items[0]

    const db = getDatabase()
    const row = await db.items.get(note.id)
    if (!row) throw new Error('missing row')
    await db.items.put({ ...row, payload: { ...row.payload, ciphertext: tamper(row.payload.ciphertext) } })

    const loaded = await loadLibrary(session)
    expect(loaded.ok).toBe(false)
    if (loaded.ok) throw new Error('unexpected success')
    expect(loaded.code).toBe('corrupt')
  })
})

describe('repository conflicts and generations', () => {
  it('rejects a stale version with conflict and keeps the first edit', async () => {
    const { session, snapshot } = await setup()
    const created = await createNote(session, contextOf(snapshot), noteInput('original body'))
    if (!created.ok) throw new Error(created.message)
    const note = created.snapshot.items[0]
    const base: MutationContext = { ...contextOf(created.snapshot), expectedVersion: note.version }

    const first = await updateNote(session, base, note.id, noteInput('first edit'))
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.message)

    const stale = await updateNote(session, base, note.id, noteInput('second edit'))
    expect(stale.ok).toBe(false)
    if (stale.ok) throw new Error('unexpected success')
    expect(stale.code).toBe('conflict')

    const loaded = await loadLibrary(session)
    if (!loaded.ok) throw new Error(loaded.message)
    expect(loaded.snapshot.items[0].body).toBe('first edit')
  })

  it('rejects an old generation after an import and overwrites nothing', async () => {
    const { session, snapshot } = await setup()
    const created = await createNote(session, contextOf(snapshot), noteInput('old library body'))
    if (!created.ok) throw new Error(created.message)
    const oldContext = contextOf(created.snapshot)

    const imported = importedNote(vaultB.header.vaultId, 'imported body')
    const importedRecord = await encryptItem(sessionOf(vaultB), imported)
    const replaced = await replaceLibrary(
      sessionOf(vaultB),
      { expectedGeneration: 1, expectedRevision: created.snapshot.meta.revision },
      [importedRecord],
    )
    expect(replaced.ok).toBe(true)
    if (!replaced.ok) throw new Error(replaced.message)
    expect(replaced.snapshot.meta.generation).toBe(2)

    const stale = await createNote(session, oldContext, noteInput('must not persist'))
    expect(stale.ok).toBe(false)
    if (stale.ok) throw new Error('unexpected success')
    expect(stale.code).toBe('vault-changed')

    const stored = await readStoredSnapshot()
    if (!stored.ok) throw new Error(stored.message)
    expect(stored.snapshot.meta.generation).toBe(2)
    expect(stored.snapshot.items.map((item) => item.id)).toEqual([imported.id])
  })

  it('supports an initial import when no library exists', async () => {
    const imported = importedNote(vaultB.header.vaultId, 'initial import body')
    const record = await encryptItem(sessionOf(vaultB), imported)
    const result = await replaceLibrary(
      sessionOf(vaultB),
      { expectedGeneration: null, expectedRevision: null },
      [record],
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.snapshot.meta.generation).toBe(1)
    expect(result.snapshot.items[0].body).toBe('initial import body')
  })

  it('refuses to initialize when a library already exists', async () => {
    await setup()
    const again = await initializeLibrary(vaultA)
    expect(again.ok).toBe(false)
    if (again.ok) throw new Error('unexpected success')
    expect(again.code).toBe('conflict')
  })
})

describe('repository tree operations', () => {
  it('refuses to delete a subtree that changed concurrently', async () => {
    const { session, snapshot } = await setup()
    const parent = await createCollection(session, contextOf(snapshot), {
      parentId: null,
      title: 'Parent',
      color: 'sage',
    })
    if (!parent.ok) throw new Error(parent.message)
    const parentId = parent.snapshot.items[0].id
    const parentVersion = parent.snapshot.items[0].version

    const child = await createNote(session, contextOf(parent.snapshot), noteInput('child body', { parentId }))
    if (!child.ok) throw new Error(child.message)
    const childId = child.snapshot.items.find((item) => item.parentId === parentId)!.id
    const confirmedRevision = child.snapshot.meta.revision

    const added = await createNote(session, contextOf(child.snapshot), noteInput('new child body', { parentId }))
    if (!added.ok) throw new Error(added.message)
    const newChildId = added.snapshot.items.find((item) => item.parentId === parentId && item.id !== childId)!.id

    const result = await deleteItem(session, {
      generation: added.snapshot.meta.generation,
      expectedRevision: confirmedRevision,
      expectedVersion: parentVersion,
    }, parentId)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unexpected success')
    expect(result.code).toBe('conflict')

    const loaded = await loadLibrary(session)
    if (!loaded.ok) throw new Error(loaded.message)
    const ids = loaded.snapshot.items.map((item) => item.id)
    expect(ids).toContain(parentId)
    expect(ids).toContain(childId)
    expect(ids).toContain(newChildId)
  })

  it('rejects moving a collection under its own descendant with zero writes', async () => {
    const { session, snapshot } = await setup()
    const outer = await createCollection(session, contextOf(snapshot), {
      parentId: null,
      title: 'Outer',
      color: 'sage',
    })
    if (!outer.ok) throw new Error(outer.message)
    const outerId = outer.snapshot.items[0].id

    const inner = await createCollection(session, contextOf(outer.snapshot), {
      parentId: outerId,
      title: 'Inner',
      color: 'clay',
    })
    if (!inner.ok) throw new Error(inner.message)
    const innerId = inner.snapshot.items.find((item) => item.parentId === outerId)!.id

    const before = await readStoredSnapshot()
    if (!before.ok) throw new Error(before.message)

    const result = await moveItem(
      session,
      {
        generation: before.snapshot.meta.generation,
        expectedRevision: before.snapshot.meta.revision,
        expectedVersion: before.snapshot.items.find((item) => item.id === outerId)!.version,
      },
      outerId,
      innerId,
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unexpected success')
    expect(result.code).toBe('validation')

    const after = await readStoredSnapshot()
    if (!after.ok) throw new Error(after.message)
    expect(JSON.stringify(after.snapshot)).toBe(JSON.stringify(before.snapshot))
  })

  it('treats a move to the current parent as a successful no-op', async () => {
    const { session, snapshot } = await setup()
    const created = await createNote(session, contextOf(snapshot), noteInput('stay put'))
    if (!created.ok) throw new Error(created.message)
    const note = created.snapshot.items[0]

    const result = await moveItem(
      session,
      { generation: created.snapshot.meta.generation, expectedRevision: created.snapshot.meta.revision, expectedVersion: note.version },
      note.id,
      note.parentId,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.snapshot.meta.revision).toBe(created.snapshot.meta.revision)
    expect(result.snapshot.items[0].parentId).toBeNull()
    expect(result.snapshot.items[0].version).toBe(note.version)
  })

  it('deletes a whole collection subtree and increments the revision', async () => {
    const { session, snapshot } = await setup()
    const parent = await createCollection(session, contextOf(snapshot), {
      parentId: null,
      title: 'Doomed',
      color: 'ochre',
    })
    if (!parent.ok) throw new Error(parent.message)
    const parentId = parent.snapshot.items[0].id
    const parentVersion = parent.snapshot.items[0].version

    const child = await createCollection(session, contextOf(parent.snapshot), {
      parentId,
      title: 'Child',
      color: 'slate',
    })
    if (!child.ok) throw new Error(child.message)
    const childId = child.snapshot.items.find((item) => item.parentId === parentId)!.id
    const note = await createNote(session, contextOf(child.snapshot), noteInput('nested note', { parentId: childId }))
    if (!note.ok) throw new Error(note.message)

    const result = await deleteItem(
      session,
      { generation: note.snapshot.meta.generation, expectedRevision: note.snapshot.meta.revision, expectedVersion: parentVersion },
      parentId,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.snapshot.items).toHaveLength(0)
    expect(result.snapshot.meta.revision).toBe(note.snapshot.meta.revision + 1)
  })
})

describe('repository timestamps and passphrase', () => {
  it('never moves updatedAt backwards when the clock moves back', async () => {
    const { session, snapshot } = await setup()
    const created = await createNote(session, contextOf(snapshot), noteInput('clock body'))
    if (!created.ok) throw new Error(created.message)
    const note = created.snapshot.items[0]

    const future = Date.now() + 10_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(future)
    const advanced = await updateNote(
      session,
      { ...contextOf(created.snapshot), expectedVersion: note.version },
      note.id,
      noteInput('clock body advanced'),
    )
    expect(advanced.ok).toBe(true)
    if (!advanced.ok) throw new Error(advanced.message)
    const advancedNote = advanced.snapshot.items[0]
    expect(advancedNote.updatedAt).toBe(future)

    nowSpy.mockReturnValue(future - 20_000_000)
    const backwards = await updateNote(
      session,
      { ...contextOf(advanced.snapshot), expectedVersion: advancedNote.version },
      note.id,
      noteInput('clock body backwards'),
    )
    expect(backwards.ok).toBe(true)
    if (!backwards.ok) throw new Error(backwards.message)
    nowSpy.mockRestore()

    expect(backwards.snapshot.items[0].updatedAt).toBe(advancedNote.updatedAt)
  })

  it('rewraps the passphrase and keeps records decryptable', async () => {
    const { session, snapshot } = await setup()
    const created = await createNote(session, contextOf(snapshot), noteInput('passphrase body', { title: 'Kept' }))
    if (!created.ok) throw new Error(created.message)

    const newHeader = await rewrapVault(session, fixturePassphrase, NEW_PASSPHRASE)
    const changed = await changePassphrase(session, contextOf(created.snapshot), newHeader)
    expect(changed.ok).toBe(true)
    if (!changed.ok) throw new Error(changed.message)

    const header = await readHeader()
    if (!header.ok || header.library !== 'present') throw new Error('no header')
    expect(header.header.header.salt).toBe(newHeader.salt)

    const unlocked = await unlockVault(newHeader, NEW_PASSPHRASE, changed.snapshot.meta.generation)
    expect(unlocked.ok).toBe(true)
    if (!unlocked.ok) throw new Error(unlocked.message)
    const loaded = await loadLibrary(unlocked.session)
    if (!loaded.ok) throw new Error(loaded.message)
    expect(loaded.snapshot.items[0].body).toBe('passphrase body')
  }, 30000)
})

describe('repository persistence request', () => {
  it('saves successfully when persistent storage is denied', async () => {
    const persist = vi.fn().mockResolvedValue(false)
    vi.stubGlobal('navigator', { storage: { persist } })

    const { session, snapshot } = await setup()
    const created = await createNote(session, contextOf(snapshot), noteInput('saved anyway'))
    expect(created.ok).toBe(true)
    expect(persist).toHaveBeenCalled()
    expect(getPersistenceState()).toBe('denied')
  })

  it('does not wait on a persistence prompt that never resolves', async () => {
    const persist = vi.fn().mockReturnValue(new Promise<boolean>(() => {}))
    vi.stubGlobal('navigator', { storage: { persist } })

    const { session, snapshot } = await setup()
    const created = await Promise.race([
      createNote(session, contextOf(snapshot), noteInput('saved while prompt pending')),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 2000)),
    ])
    expect(created).not.toBe('timeout')
    expect(persist).toHaveBeenCalled()
    if (created !== 'timeout') expect(created.ok).toBe(true)
  })

  it('saves successfully when persistent storage is unavailable', async () => {
    vi.stubGlobal('navigator', {})

    const { session, snapshot } = await setup()
    const created = await createNote(session, contextOf(snapshot), noteInput('saved without persistence'))
    expect(created.ok).toBe(true)
    expect(getPersistenceState()).toBe('unsupported')
  })
})

const hasBroadcastChannel = typeof BroadcastChannel !== 'undefined'

describe('change notifications', () => {
  it.skipIf(!hasBroadcastChannel)('delivers metadata-only changes', async () => {
    const channel = new BroadcastChannel('scratch-v1-changes')
    const received: Array<ChangeNotification | null> = []
    const subscription = subscribeToChanges((change) => received.push(change))
    try {
      const notification: ChangeNotification = { vaultId: 'vault-1', generation: 1, revision: 4 }
      channel.postMessage(notification)
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(received).toHaveLength(1)
      expect(received[0]).toEqual(notification)
      expect(JSON.stringify(received[0])).not.toContain('body')
    } finally {
      subscription.unsubscribe()
      channel.close()
    }
  })

  it.skipIf(!hasBroadcastChannel)('publishes only identifiers and revisions', async () => {
    const channel = new BroadcastChannel('scratch-v1-changes')
    const messages: unknown[] = []
    channel.onmessage = (event: MessageEvent) => messages.push(event.data)
    try {
      publishChange({ vaultId: 'vault-2', generation: 2, revision: 7 })
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(messages).toEqual([{ vaultId: 'vault-2', generation: 2, revision: 7 }])
    } finally {
      channel.close()
    }
  })
})

describe('repository read paths and header guards', () => {
  it('reports an explicit absent library before setup', async () => {
    const header = await readHeader()
    expect(header.ok).toBe(true)
    if (!header.ok) throw new Error(header.message)
    expect(header.library).toBe('absent')
  })

  it('reads the header without loading item rows', async () => {
    const { session, snapshot } = await setup()
    const created = await createNote(session, contextOf(snapshot), noteInput('header read body'))
    if (!created.ok) throw new Error(created.message)

    const db = getDatabase()
    const spy = vi.spyOn(db.items, 'toArray')
    const header = await readHeader()
    expect(header.ok).toBe(true)
    if (!header.ok) throw new Error(header.message)
    expect(header.library).toBe('present')
    expect(spy).not.toHaveBeenCalled()
  })

  it('rejects an unsupported vault header and never persists it', async () => {
    const { session, snapshot } = await setup()
    const created = await createNote(session, contextOf(snapshot), noteInput('header guard'))
    if (!created.ok) throw new Error(created.message)

    const badHeader = { ...session.header, formatVersion: 2 } as unknown as VaultHeader
    const result = await changePassphrase(session, contextOf(created.snapshot), badHeader)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unexpected success')
    expect(result.code).toBe('validation')

    const header = await readHeader()
    if (!header.ok || header.library !== 'present') throw new Error('no header')
    expect(header.header.header.formatVersion).toBe(1)
    expect(header.header.header.salt).toBe(session.header.salt)
  })
})

describe('repository committed-write reporting', () => {
  it('reports success even when publishing a change fails', async () => {
    class ThrowingChannel {
      postMessage(): void {
        throw new Error('channel unavailable')
      }
      addEventListener(): void {}
      removeEventListener(): void {}
      close(): void {}
    }
    vi.stubGlobal('BroadcastChannel', ThrowingChannel as unknown as typeof BroadcastChannel)

    const { session, snapshot } = await setup()
    const created = await createNote(session, contextOf(snapshot), noteInput('saved despite publish failure'))
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error(created.message)
    expect(created.snapshot.items).toHaveLength(1)
    expect(created.snapshot.meta.revision).toBe(snapshot.meta.revision + 1)
  })
})

describe('repository unseen-descendant and corrupt-tree guards', () => {
  it('refuses to delete when an unseen descendant appeared without a revision change', async () => {
    const { session, snapshot } = await setup()
    const parent = await createCollection(session, contextOf(snapshot), { parentId: null, title: 'Guarded', color: 'sage' })
    if (!parent.ok) throw new Error(parent.message)
    const parentId = parent.snapshot.items[0].id
    const parentVersion = parent.snapshot.items[0].version

    const child = await createNote(session, contextOf(parent.snapshot), noteInput('existing child', { parentId }))
    if (!child.ok) throw new Error(child.message)
    const childId = child.snapshot.items.find((item) => item.parentId === parentId)!.id
    const context: MutationContext = {
      generation: child.snapshot.meta.generation,
      expectedRevision: child.snapshot.meta.revision,
      expectedVersion: parentVersion,
    }

    const extraItem = importedNote(vaultA.header.vaultId, 'unseen child')
    const extraStored = await encryptItem(session, { ...extraItem, parentId })

    // Add the child between the delete's pre-read and its write transaction so
    // the revision still matches and only the subtree comparison can catch it.
    const db = getDatabase()
    const original = db.items.toArray.bind(db.items)
    let calls = 0
    db.items.toArray = (async () => {
      calls += 1
      if (calls === 2) await db.items.put(extraStored)
      return original()
    }) as typeof db.items.toArray
    try {
      const result = await deleteItem(session, context, parentId)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unexpected success')
      expect(result.code).toBe('conflict')
      expect(calls).toBeGreaterThanOrEqual(2)
    } finally {
      db.items.toArray = original
    }

    const stored = await readStoredSnapshot()
    if (!stored.ok) throw new Error(stored.message)
    const ids = stored.snapshot.items.map((item) => item.id)
    expect(ids).toContain(parentId)
    expect(ids).toContain(childId)
    expect(ids).toContain(extraItem.id)
  })

  it('reports corrupt instead of hanging when the stored tree contains a cycle', async () => {
    const { session, snapshot } = await setup()
    const outer = await createCollection(session, contextOf(snapshot), { parentId: null, title: 'Outer', color: 'sage' })
    if (!outer.ok) throw new Error(outer.message)
    const outerItem = outer.snapshot.items[0]

    const inner = await createCollection(session, contextOf(outer.snapshot), { parentId: outerItem.id, title: 'Inner', color: 'clay' })
    if (!inner.ok) throw new Error(inner.message)
    const innerId = inner.snapshot.items.find((item) => item.parentId === outerItem.id)!.id

    // Re-encrypt Outer so it still authenticates after its parent changes,
    // then store it directly to introduce a cycle with no revision change.
    const db = getDatabase()
    const cycled = await encryptItem(session, { ...outerItem, parentId: innerId })
    await db.items.put(cycled)

    const result = await deleteItem(
      session,
      { generation: inner.snapshot.meta.generation, expectedRevision: inner.snapshot.meta.revision, expectedVersion: outerItem.version },
      outerItem.id,
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unexpected success')
    expect(result.code).toBe('corrupt')

    const stored = await readStoredSnapshot()
    if (!stored.ok) throw new Error(stored.message)
    const ids = stored.snapshot.items.map((item) => item.id).sort()
    expect(ids).toEqual([outerItem.id, innerId].sort())
  })
})
