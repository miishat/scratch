import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/app/App'
import { NoteReader } from '../src/features/notes/NoteReader'
import { createVault } from '../src/features/vault/crypto'
import type { CreatedVault, VaultSession } from '../src/features/vault/types'
import type { LibraryItem } from '../src/features/library/types'
import {
  createCollection,
  createNote,
  initializeLibrary,
  loadLibrary,
  resetRepositoryForTests,
  updateNote,
} from '../src/features/library/repository'
import { closeDatabase, deleteDatabase, useDatabaseName } from '../src/features/library/database'
import { fixtureSecretBody } from './fixtures/library'

// Capture and editing run through the real app, vault, and fake-indexeddb
// repository, so every assertion about content is an assertion about what was
// actually committed.

vi.mock('../src/features/library/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/library/repository')>()
  return { ...actual, createNote: vi.fn(actual.createNote), updateNote: vi.fn(actual.updateNote) }
})

vi.setConfig({ testTimeout: 60000 })

const PASSPHRASE = 'correct horse battery staple'
let vault: CreatedVault
let dbName: string
let session: VaultSession
let collectionId: string
let noteId: string

beforeAll(async () => {
  vault = await createVault(PASSPHRASE)
}, 30000)

beforeEach(async () => {
  dbName = `scratch-note-editor-${crypto.randomUUID()}`
  useDatabaseName(dbName)
  resetRepositoryForTests()
  vi.mocked(createNote).mockClear()
  vi.mocked(updateNote).mockClear()
  window.history.replaceState(null, '', '#/')
  const init = await initializeLibrary(vault)
  if (!init.ok) throw new Error(init.message)
  session = init.session
})

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await closeDatabase()
  await deleteDatabase(dbName)
  resetRepositoryForTests()
  document.documentElement.style.removeProperty('--visual-height')
})

async function currentContext() {
  const loaded = await loadLibrary(session)
  if (!loaded.ok) throw new Error(loaded.message)
  return { snapshot: loaded.snapshot, context: { generation: loaded.snapshot.meta.generation, expectedRevision: loaded.snapshot.meta.revision } }
}

async function seed(): Promise<void> {
  const first = await currentContext()
  const made = await createCollection(session, first.context, { parentId: null, title: 'Inbox', color: 'sage' })
  if (!made.ok) throw new Error(made.message)
  collectionId = made.snapshot.items[0].id
  const second = await currentContext()
  const note = await createNote(session, second.context, { parentId: collectionId, title: 'Shopping', body: 'milk and eggs', isSecret: false })
  if (!note.ok) throw new Error(note.message)
  noteId = note.snapshot.items.find((item) => item.kind === 'note')!.id
}

async function stored(): Promise<LibraryItem[]> {
  return (await currentContext()).snapshot.items
}

async function notes(): Promise<LibraryItem[]> {
  return (await stored()).filter((item) => item.kind === 'note')
}

async function unlock(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Passphrase'), PASSPHRASE)
  await user.click(screen.getByRole('button', { name: 'Unlock' }))
  await screen.findByRole('button', { name: 'Settings' }, { timeout: 30000 })
}

async function openApp(options: { hash?: string, children?: React.ReactNode } = {}) {
  const user = userEvent.setup()
  window.history.replaceState(null, '', options.hash ?? '#/')
  render(<App>{options.children}</App>)
  await unlock(user)
  return user
}

async function startNote(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'New note' }))
  return screen.getByRole('textbox', { name: 'Note body' })
}

async function traverse(action: () => void) {
  await act(async () => {
    action()
    await new Promise((resolve) => setTimeout(resolve, 120))
  })
}

describe('quick capture', () => {
  it('creates one note in the current collection with a derived title', async () => {
    await seed()
    const user = await openApp({ hash: `#/c/${collectionId}` })
    const body = await startNote(user)
    expect(body).toHaveFocus()
    expect(screen.queryByRole('textbox', { name: 'Title' })).not.toBeInTheDocument()
    await user.type(body, 'Call the dentist{Enter}Bring the form')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const created = (await notes()).filter((note) => note.title === null)
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ parentId: collectionId, body: 'Call the dentist\nBring the form', isSecret: false })
    expect(await screen.findByRole('link', { name: 'Call the dentist' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New note' })).toHaveFocus()
  })

  it('stores the body byte for byte, including spaces, newlines, and Unicode', async () => {
    const user = await openApp()
    const body = await startNote(user)
    const text = '  indented\n\n\tTabbed é́ ✓ 🙂 family 👨‍👩‍👧\r\ntrailing   '
    await user.click(body)
    await user.paste(text)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved')
    const [saved] = await notes()
    expect(Array.from(new TextEncoder().encode(saved.body ?? ''))).toEqual(Array.from(new TextEncoder().encode(text.replace(/\r\n/g, '\n'))))
  })

  it('rejects a whitespace-only note without writing', async () => {
    const user = await openApp()
    const body = await startNote(user)
    await user.type(body, '   {Enter}  ')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A note body cannot be empty.')
    expect(createNote).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('blocks a Secret note without a title and never derives a title from the token', async () => {
    const user = await openApp()
    const body = await startNote(user)
    await user.click(body)
    await user.paste(fixtureSecretBody)
    await user.click(screen.getByRole('checkbox', { name: 'Secret note' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A secret note requires a title.')
    expect(createNote).not.toHaveBeenCalled()
    expect(await notes()).toHaveLength(0)
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveFocus()

    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Deploy token')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved')
    const [saved] = await notes()
    expect(saved).toMatchObject({ title: 'Deploy token', body: fixtureSecretBody, isSecret: true })
    const tile = await screen.findByRole('link', { name: 'Deploy token, secret note' })
    expect(tile).toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain(fixtureSecretBody)
  })

  it.each([
    ['quota', 'Local storage is full. Free some space and try again.'],
    ['unavailable', 'Local storage is unavailable. Try again.'],
  ] as const)('keeps the editor and draft when the repository reports %s', async (code, message) => {
    const user = await openApp()
    const body = await startNote(user)
    await user.type(body, 'keep this draft')
    vi.mocked(createNote).mockResolvedValueOnce({ ok: false, code, message })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Note body' })).toHaveValue('keep this draft')
    expect(screen.getByRole('textbox', { name: 'Note body' })).toHaveFocus()
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
    expect(await notes()).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved')
    expect(await notes()).toHaveLength(1)
  })

  it('writes once for a double click and repeated shortcuts, and disables Save while pending', async () => {
    const user = await openApp()
    const body = await startNote(user)
    await user.type(body, 'only once')
    const real = vi.mocked(createNote).getMockImplementation()!
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    vi.mocked(createNote).mockImplementation(async (...args) => { await gate; return real(...args) })
    const save = screen.getByRole('button', { name: 'Save' })
    await user.dblClick(save)
    fireEvent.keyDown(body, { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(body, { key: 'Enter', metaKey: true })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    release()
    await screen.findByText('Saved')
    expect(createNote).toHaveBeenCalledTimes(1)
    expect(await notes()).toHaveLength(1)
  })

  it('does not save on Ctrl+Enter during IME composition, and saves once composition ends', async () => {
    const user = await openApp()
    const body = await startNote(user)
    await user.type(body, 'kana')
    fireEvent.keyDown(body, { key: 'Enter', ctrlKey: true, isComposing: true })
    fireEvent.keyDown(body, { key: 'Enter', metaKey: true, keyCode: 229 })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
    expect(createNote).not.toHaveBeenCalled()
    fireEvent.keyDown(body, { key: 'Enter', ctrlKey: true })
    await screen.findByText('Saved')
    expect(createNote).toHaveBeenCalledTimes(1)
  })
})

describe('dirty guards', () => {
  it('asks before Escape or Cancel discards, and closes a clean editor at once', async () => {
    const user = await openApp()
    await startNote(user)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const body = await startNote(user)
    await user.type(body, 'half a thought')
    await user.keyboard('{Escape}')
    const group = screen.getByRole('group', { name: 'Unsaved changes' })
    await user.click(within(group).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('textbox', { name: 'Note body' })).toHaveValue('half a thought')
    // The Keep editing button unmounts; focus must return to the note, not fall to the page.
    expect(screen.getByRole('textbox', { name: 'Note body' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(within(screen.getByRole('group', { name: 'Unsaved changes' })).getByRole('button', { name: 'Discard' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await notes()).toHaveLength(0)
  })

  it('restores the route and the draft when Back is answered with Keep editing', async () => {
    await seed()
    const user = await openApp()
    await user.click(await screen.findByRole('link', { name: 'Inbox, 1 item' }))
    await user.click(screen.getByRole('link', { name: 'Shopping' }))
    const noteRoute = `#/c/${collectionId}/n/${noteId}`
    expect(window.location.hash).toBe(noteRoute)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: 'Note body' }), ' and bread')
    await traverse(() => window.history.back())
    const group = screen.getByRole('group', { name: 'Unsaved changes' })
    await user.click(within(group).getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(window.location.hash).toBe(noteRoute))
    expect(screen.getByRole('textbox', { name: 'Note body' })).toHaveValue('milk and eggs and bread')
    expect((await notes())[0].body).toBe('milk and eggs')

    await traverse(() => window.history.back())
    await user.click(within(screen.getByRole('group', { name: 'Unsaved changes' })).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(window.location.hash).toBe(`#/c/${collectionId}`))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect((await notes())[0].body).toBe('milk and eggs')
  })

  it('blocks in-app navigation of a dirty new note until the person chooses', async () => {
    await seed()
    const user = await openApp({ hash: `#/c/${collectionId}` })
    const body = await startNote(user)
    await user.type(body, 'draft in progress')
    fireEvent.click(screen.getByRole('link', { name: 'Scratch home' }))
    const group = await screen.findByRole('group', { name: 'Unsaved changes' })
    expect(window.location.hash).toBe(`#/c/${collectionId}`)
    await user.click(within(group).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('textbox', { name: 'Note body' })).toHaveValue('draft in progress')
    expect(window.location.hash).toBe(`#/c/${collectionId}`)
    fireEvent.click(screen.getByRole('link', { name: 'Scratch home' }))
    await user.click(within(await screen.findByRole('group', { name: 'Unsaved changes' })).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(window.location.hash).toBe('#/'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await notes()).toHaveLength(1)
  })

  it('asks the browser to confirm leaving the page only while the draft is dirty', async () => {
    const user = await openApp()
    const body = await startNote(user)
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
    await user.type(body, 'unsaved')
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })

  it('blocks Change passphrase while a draft is dirty so the draft cannot be lost', async () => {
    const user = await openApp()
    const body = await startNote(user)
    await user.type(body, 'precious')
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    const change = await screen.findByRole('button', { name: 'Change Passphrase' })
    expect(change).toBeDisabled()
    expect(screen.getByText(/Save or discard your unsaved note/)).toBeInTheDocument()
    expect(screen.getAllByRole('textbox', { name: 'Note body' })[0]).toHaveValue('precious')
  })

  it('saves the dirty draft through Save and lock', async () => {
    const user = await openApp()
    const body = await startNote(user)
    await user.type(body, 'saved while locking')
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Lock Current Tab' }))
    await user.click(await screen.findByRole('button', { name: 'Save and lock' }))
    await screen.findByRole('heading', { name: 'Unlock Scratch' })
    expect((await notes()).map((note) => note.body)).toEqual(['saved while locking'])
  })
})

// Hides the tab long enough for the automatic lock, the way a phone left alone
// does. Only timers and the clock are faked, and only for this step.
async function lockAutomatically() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
  act(() => { vi.advanceTimersByTime(61_000) })
  vi.useRealTimers()
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  await screen.findByRole('heading', { name: 'Unlock Scratch' })
}

describe('draft recovery after automatic lock', () => {
  it('returns a new-note draft after unlocking the same vault', async () => {
    const user = await openApp()
    const body = await startNote(user)
    await user.type(body, 'survives the lock')
    await lockAutomatically()
    expect(document.body.textContent).not.toContain('survives the lock')
    await unlock(user)
    expect(await screen.findByRole('textbox', { name: 'Note body' })).toHaveValue('survives the lock')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved')
    expect((await notes()).map((note) => note.body)).toEqual(['survives the lock'])
  })

  it('returns an edit of an existing note to the editor', async () => {
    await seed()
    const second = await openApp({ hash: `#/c/${collectionId}/n/${noteId}` })
    await second.click(await screen.findByRole('button', { name: 'Edit' }))
    await second.type(screen.getByRole('textbox', { name: 'Note body' }), ' plus more')
    await lockAutomatically()
    await unlock(second)
    expect(await screen.findByRole('textbox', { name: 'Note body' })).toHaveValue('milk and eggs plus more')
    await second.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved')
    expect((await notes())[0].body).toBe('milk and eggs plus more')
  })
})

describe('editing an existing note', () => {
  it('reads first, then saves an edit with a bumped version and returns focus to the tile', async () => {
    await seed()
    const user = await openApp({ hash: `#/c/${collectionId}/n/${noteId}` })
    expect(await screen.findByText('milk and eggs')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: 'Note body' }), ' and bread')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved')
    const [saved] = await notes()
    expect(saved).toMatchObject({ id: noteId, version: 2, body: 'milk and eggs and bread', title: 'Shopping' })
    expect(window.location.hash).toBe(`#/c/${collectionId}`)
    await waitFor(() => expect(screen.getByRole('link', { name: 'Shopping' })).toHaveFocus())
  })

  it('opens straight in the editor from the Edit button on a tile', async () => {
    await seed()
    const user = await openApp({ hash: `#/c/${collectionId}` })
    await user.click(await screen.findByRole('button', { name: 'Edit Shopping' }))
    const body = await screen.findByRole('textbox', { name: 'Note body' })
    expect(body).toHaveValue('milk and eggs')
    expect(screen.getByRole('dialog', { name: 'Edit note' })).toBeInTheDocument()
  })

  it('shows Latest and Your draft after a stale save, leaving the newer note untouched', async () => {
    await seed()
    const user = await openApp({ hash: `#/c/${collectionId}/n/${noteId}` })
    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const field = screen.getByRole('textbox', { name: 'Note body' })
    await user.clear(field)
    await user.type(field, 'my draft')
    const other = await currentContext()
    const written = await updateNote(session, { ...other.context, expectedVersion: 1 }, noteId, { parentId: collectionId, title: 'Shopping', body: 'newer elsewhere', isSecret: false })
    expect(written.ok).toBe(true)
    const channel = new BroadcastChannel('scratch-v1-changes')
    channel.postMessage({ vaultId: session.header.vaultId, generation: session.generation, revision: 99 })
    channel.close()
    expect(await screen.findByText(/Another tab changed this library./)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    const latest = await screen.findByRole('region', { name: 'Latest' })
    expect(latest).toHaveTextContent('newer elsewhere')
    expect(screen.getByRole('region', { name: 'Your draft' })).toHaveTextContent('my draft')
    expect((await notes())[0]).toMatchObject({ body: 'newer elsewhere', version: 2 })
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
    // The other tab wrote once; Save tried twice (stale revision, then fresh revision refused by the note's own version).
    expect(updateNote).toHaveBeenCalledTimes(3)

    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('textbox', { name: 'Note body' })).toHaveValue('my draft')
    expect((await notes())[0].body).toBe('newer elsewhere')
  })

  it('saves an in-place edit once after an unrelated write in another tab', async () => {
    await seed()
    const user = await openApp({ hash: `#/c/${collectionId}/n/${noteId}` })
    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: 'Note body' }), ' and bread')
    const other = await currentContext()
    const made = await createNote(session, other.context, { parentId: null, title: 'Unrelated', body: 'elsewhere', isSecret: false })
    expect(made.ok).toBe(true)
    const channel = new BroadcastChannel('scratch-v1-changes')
    channel.postMessage({ vaultId: session.header.vaultId, generation: session.generation, revision: 99 })
    channel.close()
    await screen.findByText(/Another tab changed this library./)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved')
    expect(screen.queryByRole('region', { name: 'Latest' })).not.toBeInTheDocument()
    expect(screen.queryByText(/changed elsewhere/)).not.toBeInTheDocument()
    const all = await notes()
    expect(all.find((note) => note.id === noteId)).toMatchObject({ body: 'milk and eggs and bread', version: 2 })
    expect(all.find((note) => note.title === 'Unrelated')).toBeDefined()
    // One refused attempt on the stale revision, then exactly one committed write.
    expect(updateNote).toHaveBeenCalledTimes(2)
  })

  it('still blocks an in-place edit when the retry finds a replaced library', async () => {
    await seed()
    const user = await openApp({ hash: `#/c/${collectionId}/n/${noteId}` })
    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: 'Note body' }), ' more')
    vi.mocked(updateNote)
      .mockResolvedValueOnce({ ok: false, code: 'conflict', message: 'Another tab changed this library. Review the latest version and try again.' })
      .mockResolvedValueOnce({ ok: false, code: 'vault-changed', message: 'This library was replaced. Unlock the current library to continue.' })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('region', { name: 'Library replaced' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save as new note' })).not.toBeInTheDocument()
    expect((await notes())[0].body).toBe('milk and eggs')
  })

  it('saves the draft as a new note without overwriting the latest', async () => {
    await seed()
    const user = await openApp({ hash: `#/c/${collectionId}/n/${noteId}` })
    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const field = screen.getByRole('textbox', { name: 'Note body' })
    await user.clear(field)
    await user.type(field, 'my draft')
    const other = await currentContext()
    await updateNote(session, { ...other.context, expectedVersion: 1 }, noteId, { parentId: collectionId, title: 'Shopping', body: 'newer elsewhere', isSecret: false })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('region', { name: 'Latest' })
    await user.click(screen.getByRole('button', { name: 'Save as new note' }))
    await screen.findByText('Saved as a new note')
    const all = await notes()
    expect(all.map((note) => note.body).sort()).toEqual(['my draft', 'newer elsewhere'])
    expect(all.find((note) => note.id === noteId)).toMatchObject({ body: 'newer elsewhere', version: 2 })
  })

  it('loads the latest version only after the draft discard is confirmed', async () => {
    await seed()
    const user = await openApp({ hash: `#/c/${collectionId}/n/${noteId}` })
    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const field = screen.getByRole('textbox', { name: 'Note body' })
    await user.clear(field)
    await user.type(field, 'my draft')
    const other = await currentContext()
    await updateNote(session, { ...other.context, expectedVersion: 1 }, noteId, { parentId: collectionId, title: 'Shopping', body: 'newer elsewhere', isSecret: false })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('region', { name: 'Latest' })
    await user.click(screen.getByRole('button', { name: 'Load latest' }))
    expect(screen.getByRole('region', { name: 'Your draft' })).toHaveTextContent('my draft')
    await user.click(screen.getByRole('button', { name: 'Discard draft and load latest' }))
    expect(await screen.findByText('newer elsewhere')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Note body' })).not.toBeInTheDocument()
    expect((await notes())[0]).toMatchObject({ body: 'newer elsewhere', version: 2 })
  })

  it('offers no save into a replaced library and lets the person discard and reload', async () => {
    await seed()
    const user = await openApp({ hash: `#/c/${collectionId}/n/${noteId}` })
    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: 'Note body' }), ' more')
    vi.mocked(updateNote).mockResolvedValueOnce({ ok: false, code: 'vault-changed', message: 'This library was replaced. Unlock the current library to continue.' })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const panel = await screen.findByRole('region', { name: 'Library replaced' })
    expect(panel).toHaveTextContent('This library was replaced.')
    expect(screen.queryByRole('button', { name: 'Save as new note' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load latest' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Discard draft and reload' }))
    await screen.findByRole('heading', { name: 'Unlock Scratch' })
    expect((await notes())[0].body).toBe('milk and eggs')
  })

  it('changes an ordinary note to Secret only with a title', async () => {
    await seed()
    const user = await openApp({ hash: `#/c/${collectionId}/n/${noteId}` })
    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('checkbox', { name: 'Secret note' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved')
    expect((await notes())[0]).toMatchObject({ isSecret: true, title: 'Shopping', version: 2 })
  })
})

describe('secret notes', () => {
  async function seedSecret(): Promise<void> {
    const { context } = await currentContext()
    const made = await createNote(session, context, { parentId: null, title: 'Router login', body: fixtureSecretBody, isSecret: true })
    if (!made.ok) throw new Error(made.message)
    noteId = made.snapshot.items[0].id
  }

  it('opens masked, reveals on request, and exposes Edit secret as a separate action', async () => {
    await seedSecret()
    const user = await openApp({ hash: `#/c/root/n/${noteId}` })
    await screen.findByRole('button', { name: 'Reveal' })
    expect(document.body.textContent).not.toContain(fixtureSecretBody)
    expect(screen.queryByRole('textbox', { name: 'Note body' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reveal' }))
    expect(screen.getByText(fixtureSecretBody)).toBeInTheDocument()
    expect(document.querySelectorAll('[aria-label]').length).toBeGreaterThan(0)
    for (const element of document.querySelectorAll('[aria-label]')) expect(element.getAttribute('aria-label')).not.toContain(fixtureSecretBody)
    await user.click(screen.getByRole('button', { name: 'Hide' }))
    expect(document.body.textContent).not.toContain(fixtureSecretBody)
    await user.click(screen.getByRole('button', { name: 'Edit secret' }))
    expect(screen.getByRole('textbox', { name: 'Note body' })).toHaveValue(fixtureSecretBody)
  })
})

describe('secret reveal timing', () => {
  const secret = { id: 'n1', vaultId: 'v', parentId: null, kind: 'note', version: 1, createdAt: 1, updatedAt: 1, title: 'Router login', body: fixtureSecretBody, isSecret: true, color: null } as LibraryItem

  function setHidden(hidden: boolean) {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
  }

  afterEach(() => {
    vi.useRealTimers()
    delete (document as unknown as Record<string, unknown>).visibilityState
  })

  it('masks again after 30 seconds without touching the clipboard', () => {
    vi.useFakeTimers()
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<NoteReader note={secret} onEdit={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }))
    expect(screen.getByText(fixtureSecretBody)).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(29_999) })
    expect(screen.getByText(fixtureSecretBody)).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.queryByText(fixtureSecretBody)).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Secret hidden.')
    expect(writeText).not.toHaveBeenCalled()
    delete (navigator as unknown as Record<string, unknown>).clipboard
  })

  it('masks immediately when the document is hidden', () => {
    render(<NoteReader note={secret} onEdit={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }))
    expect(screen.getByText(fixtureSecretBody)).toBeInTheDocument()
    setHidden(true)
    expect(screen.queryByText(fixtureSecretBody)).not.toBeInTheDocument()
    setHidden(false)
    expect(screen.queryByText(fixtureSecretBody)).not.toBeInTheDocument()
  })
})

describe('mobile keyboard', () => {
  it('follows the visual viewport so Save and Cancel stay reachable above the keyboard', async () => {
    class FakeViewport extends EventTarget { height = 640; offsetTop = 0 }
    const viewport = new FakeViewport()
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
    try {
      const user = await openApp()
      await startNote(user)
      expect(document.documentElement.style.getPropertyValue('--visual-height')).toBe('640px')
      act(() => {
        viewport.height = 310
        viewport.offsetTop = 12
        viewport.dispatchEvent(new Event('resize'))
      })
      expect(document.documentElement.style.getPropertyValue('--visual-height')).toBe('310px')
      expect(document.documentElement.style.getPropertyValue('--visual-top')).toBe('12px')
      const dialog = screen.getByRole('dialog')
      expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled()
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled()
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(document.documentElement.style.getPropertyValue('--visual-height')).toBe('')
    } finally {
      delete (window as unknown as Record<string, unknown>).visualViewport
    }
  })
})

describe('recovered and new-note drafts never overwrite silently', () => {
  it('opens the conflict panel for a recovered edit when another tab changed the note while locked', async () => {
    await seed()
    const user = await openApp({ hash: `#/c/${collectionId}/n/${noteId}` })
    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: 'Note body' }), ' plus more')
    await lockAutomatically()
    const other = await currentContext()
    const written = await updateNote(session, { ...other.context, expectedVersion: 1 }, noteId, { parentId: collectionId, title: 'Shopping', body: 'changed while locked', isSecret: false })
    expect(written.ok).toBe(true)
    await unlock(user)
    const latest = await screen.findByRole('region', { name: 'Latest' })
    expect(latest).toHaveTextContent('changed while locked')
    expect(screen.getByRole('region', { name: 'Your draft' })).toHaveTextContent('milk and eggs plus more')
    expect((await notes())[0]).toMatchObject({ body: 'changed while locked', version: 2 })
    expect(updateNote).toHaveBeenCalledTimes(1)
  })

  it('saves a new note after another tab saved a different note first', async () => {
    const user = await openApp()
    const body = await startNote(user)
    await user.type(body, 'mine')
    const other = await currentContext()
    const made = await createNote(session, other.context, { parentId: null, title: 'Theirs', body: 'theirs', isSecret: false })
    expect(made.ok).toBe(true)
    const channel = new BroadcastChannel('scratch-v1-changes')
    channel.postMessage({ vaultId: session.header.vaultId, generation: session.generation, revision: 99 })
    channel.close()
    await screen.findByText(/Another tab changed this library\./)
    expect(screen.queryByRole('button', { name: 'Review latest' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved')
    expect((await notes()).map((note) => note.body).sort()).toEqual(['mine', 'theirs'])
    expect(screen.queryByText(/changed elsewhere|deleted in another tab/)).not.toBeInTheDocument()
  })

  it('writes the new note once when the first attempt conflicts only on revision', async () => {
    const user = await openApp()
    const body = await startNote(user)
    await user.type(body, 'mine')
    const other = await currentContext()
    await createNote(session, other.context, { parentId: null, title: 'Theirs', body: 'theirs', isSecret: false })
    vi.mocked(createNote).mockClear()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved')
    expect(vi.mocked(createNote)).toHaveBeenCalledTimes(2)
    expect((await notes()).filter((note) => note.body === 'mine')).toHaveLength(1)
  })

  it('still blocks a new note when the library was replaced, without retrying', async () => {
    const user = await openApp()
    const body = await startNote(user)
    await user.type(body, 'mine')
    vi.mocked(createNote).mockResolvedValueOnce({ ok: false, code: 'vault-changed', message: 'This library was replaced. Unlock the current library to continue.' })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('region', { name: 'Library replaced' })).toBeInTheDocument()
    expect(vi.mocked(createNote)).toHaveBeenCalledTimes(1)
    expect(await notes()).toHaveLength(0)
  })

  it('shows neutral copy and no Latest column when a new-note save keeps conflicting', async () => {
    const user = await openApp()
    const body = await startNote(user)
    await user.type(body, 'mine')
    const conflict = { ok: false, code: 'conflict', message: 'Another tab changed this library. Review the latest version and try again.' } as const
    vi.mocked(createNote).mockResolvedValueOnce(conflict).mockResolvedValueOnce(conflict)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const panel = await screen.findByRole('region', { name: 'Library changed' })
    expect(panel).toHaveTextContent('Your draft is unchanged')
    expect(screen.queryByRole('region', { name: 'Latest' })).not.toBeInTheDocument()
    expect(screen.queryByText(/changed elsewhere|deleted in another tab/)).not.toBeInTheDocument()
  })

  it('keeps a secret body masked in the draft column even if Secret was unchecked', async () => {
    const { context } = await currentContext()
    const made = await createNote(session, context, { parentId: null, title: 'Router login', body: fixtureSecretBody, isSecret: true })
    if (!made.ok) throw new Error(made.message)
    const id = made.snapshot.items[0].id
    const user = await openApp({ hash: `#/c/root/n/${id}` })
    await user.click(await screen.findByRole('button', { name: 'Edit secret' }))
    await user.click(screen.getByRole('checkbox', { name: 'Secret note' }))
    const other = await currentContext()
    await updateNote(session, { ...other.context, expectedVersion: 1 }, id, { parentId: null, title: 'Router login', body: 'rotated', isSecret: true })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const draftColumn = await screen.findByRole('region', { name: 'Your draft' })
    expect(draftColumn).not.toHaveTextContent(fixtureSecretBody)
    expect(document.body.textContent).not.toContain('rotated')
  })

  it('ignores Cancel, Escape, and close while a save is pending and closes once', async () => {
    const user = await openApp()
    const body = await startNote(user)
    await user.type(body, 'pending')
    const real = vi.mocked(createNote).getMockImplementation()!
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    vi.mocked(createNote).mockImplementation(async (...args) => { await gate; return real(...args) })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Saving your note.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    expect(screen.queryByRole('group', { name: 'Unsaved changes' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    release()
    await screen.findByText('Saved')
    expect(screen.getAllByText('Saved')).toHaveLength(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await notes()).toHaveLength(1)
  })
})
