import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/app/App'
import { ThemeProvider } from '../src/features/theme/ThemeProvider'
import { prepareImport, writeBackup } from '../src/features/backup/backup'
import { createVault, encryptItem } from '../src/features/vault/crypto'
import type { CreatedVault, VaultSession } from '../src/features/vault/types'
import type { LibraryItem } from '../src/features/library/types'
import {
  createNote,
  initializeLibrary,
  loadLibrary,
  readStoredSnapshot,
  resetRepositoryForTests,
} from '../src/features/library/repository'
import { closeDatabase, deleteDatabase, useDatabaseName } from '../src/features/library/database'
import type { ChangeNotification } from '../src/features/library/changes'

// The import, replace, and export flows through the real app, vault, and
// fake-indexeddb repository.

vi.setConfig({ testTimeout: 90000 })

const PHRASE = 'correct horse battery staple'
const BACKUP_PHRASE = 'another correct horse battery staple'
const OLD_TITLE = 'Existing library note'
const NEW_TITLE = 'Imported library note'

let vaultA: CreatedVault
let vaultB: CreatedVault
let dbName: string
let sessionA: VaultSession

beforeAll(async () => {
  vaultA = await createVault(PHRASE)
  vaultB = await createVault(BACKUP_PHRASE)
}, 60000)

beforeEach(() => {
  dbName = `scratch-backup-ui-${crypto.randomUUID()}`
  useDatabaseName(dbName)
  resetRepositoryForTests()
  window.history.replaceState(null, '', '#/')
  localStorage.clear()
})

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await closeDatabase()
  await deleteDatabase(dbName)
  resetRepositoryForTests()
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

function note(session: VaultSession, title: string, body: string): LibraryItem {
  return {
    id: crypto.randomUUID(),
    vaultId: session.header.vaultId,
    parentId: null,
    kind: 'note',
    version: 1,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    title,
    body,
    isSecret: false,
    color: null,
  }
}

async function backupFile(): Promise<File> {
  const session: VaultSession = { header: vaultB.header, generation: 1, dataKey: vaultB.dataKey }
  const records = [await encryptItem(session, note(session, NEW_TITLE, 'imported body')), await encryptItem(session, note(session, 'Second imported', 'x'))]
  const written = await writeBackup(session, records)
  if (!written.ok) throw new Error(written.message)
  return new File([written.blob], written.filename)
}

async function seedLibrary(): Promise<void> {
  const init = await initializeLibrary(vaultA)
  if (!init.ok) throw new Error(init.message)
  sessionA = init.session
  const result = await createNote(sessionA, { generation: 1, expectedRevision: init.snapshot.meta.revision }, { parentId: null, title: OLD_TITLE, body: 'old body', isSecret: false })
  if (!result.ok) throw new Error(result.message)
}

async function unlock(user: ReturnType<typeof userEvent.setup>, phrase = PHRASE) {
  await user.type(await screen.findByLabelText('Passphrase'), phrase)
  await user.click(screen.getByRole('button', { name: 'Unlock' }))
  await screen.findByRole('button', { name: 'Settings' }, { timeout: 30000 })
}

async function openImport(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Settings' }))
  await user.click(screen.getByRole('button', { name: 'Import backup' }))
  return screen.findByRole('dialog', { name: 'Import backup' })
}

async function chooseAndReview(user: ReturnType<typeof userEvent.setup>, file: File, phrase: string) {
  await user.upload(screen.getByLabelText('Backup file'), file)
  await user.type(screen.getByLabelText('Backup passphrase'), phrase)
  await user.click(screen.getByRole('button', { name: 'Review backup' }))
}

async function stored() {
  const result = await readStoredSnapshot()
  if (!result.ok) throw new Error(result.message)
  return result.snapshot
}

describe('first-use import', () => {
  it('imports a backup from the setup screen and opens Scratch with the theme unchanged', async () => {
    localStorage.setItem('scratch-theme', 'dark')
    const user = userEvent.setup()
    render(<ThemeProvider><App /></ThemeProvider>)
    await user.click(await screen.findByRole('button', { name: 'Import backup' }))
    expect(document.documentElement.dataset.theme).toBe('dark')

    await chooseAndReview(user, await backupFile(), BACKUP_PHRASE)
    expect(await screen.findByText('This backup contains 2 items.', undefined, { timeout: 30000 })).toBeInTheDocument()
    expect(screen.getByText(/backup's passphrase becomes the passphrase/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Export current backup' })).not.toBeInTheDocument()
    expect((await readStoredSnapshot()).ok).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Import library' }))
    expect(await screen.findByText(NEW_TITLE, undefined, { timeout: 30000 })).toBeInTheDocument()
    const state = await stored()
    expect(state.header.vaultId).toBe(vaultB.header.vaultId)
    expect(state.meta.generation).toBe(1)
    expect(state.items).toHaveLength(2)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('scratch-theme')).toBe('dark')
  })

  it('shows the safe error for a wrong passphrase and stays on setup', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Import backup' }))
    await chooseAndReview(user, await backupFile(), 'a wrong passphrase value')
    expect(await screen.findByRole('alert', undefined, { timeout: 30000 })).toHaveTextContent('Could not unlock this backup. Check the passphrase and file.')
    expect((screen.getByLabelText('Backup passphrase') as HTMLInputElement).value).toBe('')
    expect((await readStoredSnapshot()).ok).toBe(false)
  })

  it('closes with Cancel and leaves setup available', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Import backup' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Set up Scratch' })).toBeInTheDocument()
  })
})

describe('replacement from Settings', () => {
  it('cancel after review changes nothing and keeps the current passphrase', async () => {
    await seedLibrary()
    const before = await stored()
    const user = userEvent.setup()
    render(<App />)
    await unlock(user)
    await openImport(user)
    await chooseAndReview(user, await backupFile(), BACKUP_PHRASE)
    expect(await screen.findByText('This backup contains 2 items.', undefined, { timeout: 30000 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export current backup' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await stored()).toEqual(before)
    expect(screen.getByText(OLD_TITLE)).toBeInTheDocument()
    expect(screen.queryByText(NEW_TITLE)).not.toBeInTheDocument()
  })

  it('replaces the library, installs the imported session, notifies tabs with metadata only, and uses the imported passphrase from then on', async () => {
    await seedLibrary()
    const heard: unknown[] = []
    const channel = new BroadcastChannel('scratch-v1-changes')
    channel.onmessage = (event) => heard.push(event.data)
    const user = userEvent.setup()
    render(<App />)
    await unlock(user)
    await openImport(user)
    await chooseAndReview(user, await backupFile(), BACKUP_PHRASE)
    await screen.findByText('This backup contains 2 items.', undefined, { timeout: 30000 })
    await user.click(screen.getByRole('button', { name: 'Replace library' }))

    expect(await screen.findByText(NEW_TITLE, undefined, { timeout: 30000 })).toBeInTheDocument()
    expect(screen.queryByText(OLD_TITLE)).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Import backup' })).not.toBeInTheDocument()
    const state = await stored()
    expect(state.header.vaultId).toBe(vaultB.header.vaultId)
    expect(state.meta.generation).toBe(2)

    await waitFor(() => expect(heard.length).toBeGreaterThan(0))
    const message = heard.at(-1) as ChangeNotification
    expect(Object.keys(message).sort()).toEqual(['generation', 'revision', 'vaultId'])
    expect(message.generation).toBe(2)
    channel.close()

    // The installed session works for further saves with the generation actually stored.
    const loaded = await loadLibrary({ header: state.header, generation: state.meta.generation, dataKey: vaultB.dataKey })
    expect(loaded.ok && loaded.snapshot.items).toHaveLength(2)

    // Lock and unlock: only the imported passphrase works now.
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: 'Lock now' }))
    await user.type(await screen.findByLabelText('Passphrase'), PHRASE)
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByRole('alert', undefined, { timeout: 30000 })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Passphrase'), BACKUP_PHRASE)
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByText(NEW_TITLE, undefined, { timeout: 30000 })).toBeInTheDocument()
  })

  it('asks for a new review, without overwriting, when another tab changed the library after preview', async () => {
    await seedLibrary()
    const user = userEvent.setup()
    render(<App />)
    await unlock(user)
    await openImport(user)
    await chooseAndReview(user, await backupFile(), BACKUP_PHRASE)
    await screen.findByText('This backup contains 2 items.', undefined, { timeout: 30000 })

    const current = await stored()
    const other = await createNote(sessionA, { generation: 1, expectedRevision: current.meta.revision }, { parentId: null, title: 'Other tab note', body: 'b', isSecret: false })
    expect(other.ok).toBe(true)
    const afterOther = await stored()

    await user.click(screen.getByRole('button', { name: 'Replace library' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('changed after you chose the backup')
    expect(await stored()).toEqual(afterOther)
    expect(screen.getByRole('button', { name: 'Review backup' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Replace library' })).not.toBeInTheDocument()
  })

  it('exports the current library before replacing it, with the old passphrase', async () => {
    await seedLibrary()
    const blobs: Blob[] = []
    const clicks: string[] = []
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:test' }), revokeObjectURL: vi.fn() }))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this.download) })
    const user = userEvent.setup()
    render(<App />)
    await unlock(user)
    await openImport(user)
    await chooseAndReview(user, await backupFile(), BACKUP_PHRASE)
    await screen.findByText('This backup contains 2 items.', undefined, { timeout: 30000 })
    await user.click(screen.getByRole('button', { name: 'Export current backup' }))
    expect(await screen.findByText('Current library exported.')).toBeInTheDocument()
    expect(clicks[0]).toMatch(/^scratch-backup-\d{4}-\d{2}-\d{2}-\d{4}\.scratch$/)
    const prepared = await prepareImport(blobs[0], PHRASE)
    expect(prepared.ok && prepared.prepared.itemCount).toBe(1)
  })

  it('disables Import while an editor holds an unsaved note', async () => {
    await seedLibrary()
    const user = userEvent.setup()
    render(<App />)
    await unlock(user)
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(within(document.querySelector<HTMLElement>('.add-menu')!).getByRole('button', { name: 'Add note' }))
    await user.type(screen.getByRole('textbox', { name: 'Note body' }), 'unsaved words')
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByRole('button', { name: 'Import backup' })).toBeDisabled()
    expect(screen.getByText(/before importing a backup/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export backup' })).toBeEnabled()
  })
})

describe('export from Settings', () => {
  it('downloads an encrypted backup and releases the object URL', async () => {
    await seedLibrary()
    const blobs: Blob[] = []
    const names: string[] = []
    const revoke = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:test-url' }), revokeObjectURL: revoke }))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download) })
    const user = userEvent.setup()
    render(<App />)
    await unlock(user)
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByText('Stored in this browser. Export a backup to keep a copy.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Export backup' }))
    expect(await screen.findByText('Backup exported.')).toBeInTheDocument()
    expect(blobs).toHaveLength(1)
    expect(names[0]).toMatch(/\.scratch$/)
    const text = await blobs[0].text()
    expect(text).not.toContain(OLD_TITLE)
    expect(text).not.toContain('old body')
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:test-url'), { timeout: 15000 })
  })
})

describe('stale tab recovery export', () => {
  it('exports the old library plus the unsaved draft from the recovery panel', async () => {
    await seedLibrary()
    const blobs: Blob[] = []
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:recovery' }), revokeObjectURL: vi.fn() }))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const user = userEvent.setup()
    render(<App />)
    await unlock(user)
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(within(document.querySelector<HTMLElement>('.add-menu')!).getByRole('button', { name: 'Add note' }))
    await user.type(screen.getByRole('textbox', { name: 'Note body' }), 'draft only in this tab')

    // Another tab replaces the whole library.
    const state = await stored()
    const { commitImport } = await import('../src/features/backup/backup')
    const prepared = await prepareImport(await backupFile(), BACKUP_PHRASE)
    if (!prepared.ok) throw new Error(prepared.message)
    const committed = await commitImport(prepared.prepared, { generation: state.meta.generation, revision: state.meta.revision })
    if (!committed.ok) throw new Error(committed.message)
    const channel = new BroadcastChannel('scratch-v1-changes')
    channel.postMessage({ vaultId: committed.snapshot.header.vaultId, generation: committed.snapshot.meta.generation, revision: committed.snapshot.meta.revision })
    channel.close()
    const afterReplace = await stored()

    await user.click(await screen.findByRole('button', { name: 'Export backup' }))
    expect(await screen.findByText('Backup exported.')).toBeInTheDocument()
    expect(await stored()).toEqual(afterReplace)
    const recovered = await prepareImport(blobs[0], PHRASE)
    expect(recovered.ok && recovered.prepared.itemCount).toBe(2)
  })

  it('keeps the draft and says why when it cannot be exported', async () => {
    await seedLibrary()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:never'), revokeObjectURL: vi.fn() }))
    const user = userEvent.setup()
    render(<App />)
    await unlock(user)
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(within(document.querySelector<HTMLElement>('.add-menu')!).getByRole('button', { name: 'Add note' }))
    const body = screen.getByRole('textbox', { name: 'Note body' })
    await user.type(body, 'x')
    await user.click(screen.getByRole('checkbox', { name: /secret/i }))

    const channel = new BroadcastChannel('scratch-v1-changes')
    const state = await stored()
    const { commitImport } = await import('../src/features/backup/backup')
    const prepared = await prepareImport(await backupFile(), BACKUP_PHRASE)
    if (!prepared.ok) throw new Error(prepared.message)
    const committed = await commitImport(prepared.prepared, { generation: state.meta.generation, revision: state.meta.revision })
    if (!committed.ok) throw new Error(committed.message)
    channel.postMessage({ vaultId: committed.snapshot.header.vaultId, generation: committed.snapshot.meta.generation, revision: committed.snapshot.meta.revision })
    channel.close()

    await user.click(await screen.findByRole('button', { name: 'Export backup' }))
    expect(await screen.findByText(/A secret note requires a title/)).toBeInTheDocument()
    expect(screen.getByText(/Your draft is still here/)).toBeInTheDocument()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })
})
