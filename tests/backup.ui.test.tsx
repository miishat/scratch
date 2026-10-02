import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/app/App'
import { ThemeProvider } from '../src/features/theme/ThemeProvider'
import { BackupDialog } from '../src/features/backup/BackupDialog'
import { VaultProvider } from '../src/features/vault/VaultProvider'
import { commitImport, prepareImport, writeBackup } from '../src/features/backup/backup'
import { createVault, encryptItem } from '../src/features/vault/crypto'
import type { CreatedVault, VaultSession } from '../src/features/vault/types'
import type { LibraryItem } from '../src/features/library/types'
import {
  createNote,
  initializeLibrary,
  loadLibrary,
  readStoredSnapshot,
  replaceLibrary,
  resetRepositoryForTests,
} from '../src/features/library/repository'
import { closeDatabase, deleteDatabase, useDatabaseName } from '../src/features/library/database'
import type { ChangeNotification } from '../src/features/library/changes'

// The import, replace, and export flows through the real app, vault, and
// fake-indexeddb repository.

vi.mock('../src/features/backup/backup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/backup/backup')>()
  return { ...actual, commitImport: vi.fn(actual.commitImport) }
})

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
    await user.click(screen.getByRole('button', { name: 'Lock Current Tab' }))
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
    await user.click(screen.getByRole('button', { name: 'New note' }))
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
    await user.click(screen.getByRole('button', { name: 'New note' }))
    await user.type(screen.getByRole('textbox', { name: 'Note body' }), 'draft only in this tab')

    // Another tab replaces the whole library.
    const state = await stored()
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

  // A stale tab: an unsaved secret note without a title, while another tab
  // replaces the whole library. Returns a helper that announces another change.
  async function openStaleTab(user: ReturnType<typeof userEvent.setup>) {
    await seedLibrary()
    render(<App />)
    await unlock(user)
    await user.click(screen.getByRole('button', { name: 'New note' }))
    await user.type(screen.getByRole('textbox', { name: 'Note body' }), 'x')
    await user.click(screen.getByRole('checkbox', { name: /secret/i }))
    const state = await stored()
    const prepared = await prepareImport(await backupFile(), BACKUP_PHRASE)
    if (!prepared.ok) throw new Error(prepared.message)
    const committed = await commitImport(prepared.prepared, { generation: state.meta.generation, revision: state.meta.revision })
    if (!committed.ok) throw new Error(committed.message)
    const notify = () => {
      const channel = new BroadcastChannel('scratch-v1-changes')
      channel.postMessage({ vaultId: committed.snapshot.header.vaultId, generation: committed.snapshot.meta.generation, revision: committed.snapshot.meta.revision })
      channel.close()
    }
    notify()
    return notify
  }

  it('keeps an invalid draft reachable: Keep editing, then export works once it is fixed', async () => {
    const blobs: Blob[] = []
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:fixed' }), revokeObjectURL: vi.fn() }))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const user = userEvent.setup()
    const notify = await openStaleTab(user)

    await user.click(await screen.findByRole('button', { name: 'Export backup' }))
    expect(await screen.findByText(/A secret note requires a title/)).toBeInTheDocument()
    expect(URL.createObjectURL).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    const body = screen.getByRole('textbox', { name: 'Note body' })
    expect(body).toBeVisible()
    expect(body).toHaveValue('x')
    expect(screen.queryByRole('heading', { name: 'This library changed in another tab' })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Title'), 'Fixed title')

    // The next change notification brings the panel back with the corrected draft.
    notify()
    await user.click(await screen.findByRole('button', { name: 'Export backup' }))
    expect(await screen.findByText('Backup exported.')).toBeInTheDocument()
    const recovered = await prepareImport(blobs[0], PHRASE)
    expect(recovered.ok && recovered.prepared.itemCount).toBe(2)
  })

  it('after Keep editing, an automatic lock conceals the draft again instead of dropping it', async () => {
    const user = userEvent.setup()
    await openStaleTab(user)
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('textbox', { name: 'Note body' })).toHaveValue('x')

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      act(() => { document.dispatchEvent(new Event('visibilitychange')) })
      act(() => { vi.advanceTimersByTime(601_000) })
    } finally {
      vi.useRealTimers()
      delete (document as unknown as Record<string, unknown>).hidden
      delete (document as unknown as Record<string, unknown>).visibilityState
    }
    await waitFor(() => expect(screen.getByRole('heading', { name: 'This library changed in another tab' })).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: 'Unlock Scratch' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep editing' })).toBeInTheDocument()
    // The draft text is still in the (hidden) editor.
    expect(screen.getByRole('textbox', { name: 'Note body', hidden: true })).toHaveValue('x')
  })

  it('restores the editor after Keep editing even when the tab was hidden past ten minutes', async () => {
    const blobs: Blob[] = []
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:late' }), revokeObjectURL: vi.fn() }))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const user = userEvent.setup()
    const notify = await openStaleTab(user)
    await screen.findByRole('button', { name: 'Keep editing' })

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      act(() => { document.dispatchEvent(new Event('visibilitychange')) })
      act(() => { vi.advanceTimersByTime(601_000) })
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    } finally {
      vi.useRealTimers()
      delete (document as unknown as Record<string, unknown>).hidden
      delete (document as unknown as Record<string, unknown>).visibilityState
    }
    // The hidden deadline passed while the panel was up, so it asks for the passphrase.
    expect(screen.getByRole('button', { name: 'Keep editing' })).toBeDisabled()
    await user.type(screen.getByLabelText('Passphrase'), PHRASE)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Keep editing' })).toBeEnabled(), { timeout: 30000 })
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    const body = screen.getByRole('textbox', { name: 'Note body' })
    expect(body).toBeVisible()
    expect(body).toHaveValue('x')
    await user.type(screen.getByLabelText('Title'), 'Fixed title')

    notify()
    await user.click(await screen.findByRole('button', { name: 'Export backup' }))
    expect(await screen.findByText('Backup exported.')).toBeInTheDocument()
    const recovered = await prepareImport(blobs[0], PHRASE)
    expect(recovered.ok && recovered.prepared.itemCount).toBe(2)
  })

  it('saving after Keep editing shows the replaced-library panel and writes nothing to the new library', async () => {
    const user = userEvent.setup()
    await openStaleTab(user)
    const afterReplace = await stored()
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }))
    await user.type(screen.getByLabelText('Title'), 'Fixed title')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('heading', { name: 'This library was replaced' })).toBeInTheDocument()
    expect(await stored()).toEqual(afterReplace)
  })
})

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') })
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}

function resetVisibility() {
  delete (document as unknown as Record<string, unknown>).hidden
  delete (document as unknown as Record<string, unknown>).visibilityState
}

describe('dialogs survive concealing', () => {
  it('keeps the chosen file and typed passphrase across a hide and show, exposing nothing while hidden', async () => {
    await seedLibrary()
    const user = userEvent.setup()
    render(<App />)
    await unlock(user)
    await openImport(user)
    await user.upload(screen.getByLabelText('Backup file'), await backupFile())
    await user.type(screen.getByLabelText('Backup passphrase'), BACKUP_PHRASE)
    try {
      setHidden(true)
      // The page is concealed: the dialog is out of the accessibility tree and inert.
      expect(screen.queryByRole('dialog', { name: 'Import backup' })).not.toBeInTheDocument()
      const dialog = screen.getByRole('dialog', { name: 'Import backup', hidden: true })
      expect(dialog.closest('[inert]')).not.toBeNull()
      expect(dialog.closest('[hidden]')).not.toBeNull()
      // A concealed dialog never pulls focus away from whatever the person moved to.
      const outside = document.createElement('button')
      document.body.appendChild(outside)
      outside.focus()
      expect(outside).toHaveFocus()
      outside.remove()
      setHidden(false)
    } finally {
      resetVisibility()
    }
    expect((screen.getByLabelText('Backup file') as HTMLInputElement).files).toHaveLength(1)
    expect(screen.getByLabelText('Backup passphrase')).toHaveValue(BACKUP_PHRASE)
  })

  it('keeps a typed collection title across a hide and show', async () => {
    await seedLibrary()
    const user = userEvent.setup()
    render(<App />)
    await unlock(user)
    await user.click(screen.getByRole('button', { name: 'New collection' }))
    await user.type(await screen.findByLabelText('Title'), 'Travel plans')
    try {
      setHidden(true)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      setHidden(false)
    } finally {
      resetVisibility()
    }
    expect(screen.getByLabelText('Title')).toHaveValue('Travel plans')
  })

  it('removes every dialog when the tab stays hidden long enough to lock', async () => {
    await seedLibrary()
    const user = userEvent.setup()
    render(<App />)
    await unlock(user)
    await openImport(user)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      setHidden(true)
      act(() => { vi.advanceTimersByTime(601_000) })
    } finally {
      vi.useRealTimers()
      resetVisibility()
    }
    await screen.findByRole('heading', { name: 'Unlock Scratch' })
    expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument()
  })
})

describe('replacement outlives its dialog', () => {
  it('does not report success when the install was refused because the vault locked', async () => {
    await seedLibrary()
    const base = await stored()
    const prepared = await prepareImport(await backupFile(), BACKUP_PHRASE)
    if (!prepared.ok) throw new Error(prepared.message)
    const onImported = vi.fn()
    const user = userEvent.setup()
    // The provider is locked, so installing a session must be refused.
    render(<VaultProvider><BackupDialog
      replace={{ session: sessionA, currentBase: () => ({ generation: base.meta.generation, revision: base.meta.revision }) }}
      onClose={() => undefined}
      onImported={onImported}
    /></VaultProvider>)
    await screen.findByLabelText('Backup file')
    await chooseAndReview(user, await backupFile(), BACKUP_PHRASE)
    await screen.findByText('This backup contains 2 items.', undefined, { timeout: 30000 })
    await user.click(screen.getByRole('button', { name: 'Replace library' }))
    await waitFor(async () => expect((await stored()).header.vaultId).toBe(vaultB.header.vaultId))
    expect(await screen.findByRole('alert')).toHaveTextContent(/unlock/i)
    expect(onImported).not.toHaveBeenCalled()
  })

  it('installs the imported session even when the dialog unmounts during the commit', async () => {
    await seedLibrary()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const real = (await vi.importActual<typeof import('../src/features/backup/backup')>('../src/features/backup/backup')).commitImport
    vi.mocked(commitImport).mockImplementationOnce(async (prepared, base) => {
      await gate
      return real(prepared, base)
    })
    const user = userEvent.setup()
    render(<App />)
    await unlock(user)
    await openImport(user)
    await chooseAndReview(user, await backupFile(), BACKUP_PHRASE)
    await screen.findByText('This backup contains 2 items.', undefined, { timeout: 30000 })
    await user.click(screen.getByRole('button', { name: 'Replace library' }))

    // The tab is hidden mid-commit: the content, including the dialog, unmounts.
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Import backup' })).not.toBeInTheDocument())
    release()
    await waitFor(async () => expect((await stored()).header.vaultId).toBe(vaultB.header.vaultId))

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    delete (document as unknown as Record<string, unknown>).hidden
    delete (document as unknown as Record<string, unknown>).visibilityState
    expect(await screen.findByText(NEW_TITLE, undefined, { timeout: 30000 })).toBeInTheDocument()
    expect(screen.queryByText(OLD_TITLE)).not.toBeInTheDocument()
  })
})

describe('export too large', () => {
  it('refuses safely with a content-free, actionable message and no download', async () => {
    const session: VaultSession = { header: vaultB.header, generation: 1, dataKey: vaultB.dataKey }
    const records = []
    for (let n = 1; n <= 1000; n++) {
      const entry = note(session, `Heavy ${n}`, '"'.repeat(10000))
      entry.id = `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
      records.push(await encryptItem(session, entry))
    }
    const seeded = await replaceLibrary(session, { expectedGeneration: null, expectedRevision: null }, records)
    expect(seeded.ok).toBe(true)
    const before = await stored()
    const create = vi.fn(() => 'blob:never')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }))
    const user = userEvent.setup()
    render(<App />)
    await unlock(user, BACKUP_PHRASE)
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: 'Export backup' }))
    const alert = await screen.findByRole('alert', undefined, { timeout: 30000 })
    expect(alert).toHaveTextContent(/too large/i)
    expect(alert).toHaveTextContent(/delete or shorten/i)
    expect(alert.textContent).not.toContain('Heavy')
    expect(create).not.toHaveBeenCalled()
    expect(await stored()).toEqual(before)
  })
})
