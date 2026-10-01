import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/app/App'
import { createVault } from '../src/features/vault/crypto'
import type { CreatedVault, VaultSession } from '../src/features/vault/types'
import type { LibraryItem } from '../src/features/library/types'
import {
  createCollection,
  createNote,
  deleteItem,
  initializeLibrary,
  loadLibrary,
  moveItem,
  resetRepositoryForTests,
  updateCollection,
} from '../src/features/library/repository'
import { closeDatabase, deleteDatabase, useDatabaseName } from '../src/features/library/database'

// Organization runs through the real app, vault, and fake-indexeddb repository,
// so each assertion about structure is about what was actually committed.

vi.mock('../src/features/library/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/library/repository')>()
  return {
    ...actual,
    createCollection: vi.fn(actual.createCollection),
    updateCollection: vi.fn(actual.updateCollection),
    moveItem: vi.fn(actual.moveItem),
    deleteItem: vi.fn(actual.deleteItem),
  }
})

vi.setConfig({ testTimeout: 60000 })

const PASSPHRASE = 'correct horse battery staple'
let vault: CreatedVault
let dbName: string
let session: VaultSession

beforeAll(async () => {
  vault = await createVault(PASSPHRASE)
}, 30000)

beforeEach(async () => {
  dbName = `scratch-collection-actions-${crypto.randomUUID()}`
  useDatabaseName(dbName)
  resetRepositoryForTests()
  vi.mocked(createCollection).mockClear()
  vi.mocked(updateCollection).mockClear()
  vi.mocked(moveItem).mockClear()
  vi.mocked(deleteItem).mockClear()
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
})

async function context() {
  const loaded = await loadLibrary(session)
  if (!loaded.ok) throw new Error(loaded.message)
  return { items: loaded.snapshot.items, context: { generation: loaded.snapshot.meta.generation, expectedRevision: loaded.snapshot.meta.revision } }
}

async function items(): Promise<LibraryItem[]> {
  return (await context()).items
}

async function seedCollection(title: string, parentId: string | null): Promise<string> {
  const made = await createCollection(session, (await context()).context, { parentId, title, color: 'sage' })
  if (!made.ok) throw new Error(made.message)
  return made.snapshot.items.find((item) => item.title === title && item.parentId === parentId)!.id
}

async function seedNote(title: string, parentId: string | null): Promise<string> {
  const made = await createNote(session, (await context()).context, { parentId, title, body: `body of ${title}`, isSecret: false })
  if (!made.ok) throw new Error(made.message)
  return made.snapshot.items.find((item) => item.title === title)!.id
}

async function openApp(hash = '#/') {
  const user = userEvent.setup()
  window.history.replaceState(null, '', hash)
  render(<App />)
  await user.type(await screen.findByLabelText('Passphrase'), PASSPHRASE)
  await user.click(screen.getByRole('button', { name: 'Unlock' }))
  await screen.findByRole('button', { name: 'Settings' }, { timeout: 30000 })
  return user
}

type User = ReturnType<typeof userEvent.setup>

async function openTileMenu(user: User, name: string) {
  await user.click(await screen.findByRole('button', { name: `More actions for ${name}` }))
  return screen.findByRole('dialog', { name: `Actions for ${name}` })
}

async function chooseAction(user: User, name: string, action: string) {
  const menu = await openTileMenu(user, name)
  await user.click(within(menu).getByRole('button', { name: action }))
}

describe('create and edit collections', () => {
  it('creates a collection in the current parent with the chosen color', async () => {
    const parent = await seedCollection('Inbox', null)
    const user = await openApp(`#/c/${parent}`)
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(within(document.querySelector<HTMLElement>('.add-menu')!).getByRole('button', { name: 'Add collection' }))
    const dialog = await screen.findByRole('dialog', { name: 'New collection' })
    expect(within(dialog).getByRole('button', { name: 'Sage' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog).getAllByRole('button', { name: /^(Sage|Clay|Ochre|Slate)$/ })).toHaveLength(4)
    expect(dialog).toHaveTextContent('Inbox')
    await user.type(within(dialog).getByRole('textbox', { name: 'Title' }), 'Recipes')
    await user.click(within(dialog).getByRole('button', { name: 'Clay' }))
    expect(within(dialog).getByRole('button', { name: 'Clay' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog).getByRole('button', { name: 'Sage' })).toHaveAttribute('aria-pressed', 'false')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await screen.findByText('Collection created')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const created = (await items()).filter((item) => item.title === 'Recipes')
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ kind: 'collection', parentId: parent, color: 'clay' })
    expect(await screen.findByRole('link', { name: 'Recipes, 0 items' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toHaveFocus()
  })

  it('requires a title, rejects an overlong one, and allows duplicates', async () => {
    await seedCollection('Inbox', null)
    vi.mocked(createCollection).mockClear()
    const user = await openApp()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(within(document.querySelector<HTMLElement>('.add-menu')!).getByRole('button', { name: 'Add collection' }))
    const dialog = await screen.findByRole('dialog', { name: 'New collection' })
    const title = within(dialog).getByRole('textbox', { name: 'Title' })
    await user.type(title, '   ')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('A collection requires a title.')
    expect(title).toHaveFocus()
    await user.clear(title)
    await user.click(title)
    await user.paste('x'.repeat(81))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('80 characters')
    expect(createCollection).not.toHaveBeenCalled()
    await user.clear(title)
    await user.type(title, 'Inbox')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await screen.findByText('Collection created')
    expect((await items()).filter((item) => item.title === 'Inbox')).toHaveLength(2)
  })

  it('writes once for a double click and keeps the editor open on failure', async () => {
    const user = await openApp()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(within(document.querySelector<HTMLElement>('.add-menu')!).getByRole('button', { name: 'Add collection' }))
    const dialog = await screen.findByRole('dialog', { name: 'New collection' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Title' }), 'Once')
    vi.mocked(createCollection).mockResolvedValueOnce({ ok: false, code: 'quota', message: 'Not enough storage space to save. Free some space and try again.' })
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Not enough storage space')
    expect(await items()).toHaveLength(0)
    expect(within(dialog).getByRole('textbox', { name: 'Title' })).toHaveValue('Once')
    await user.dblClick(within(dialog).getByRole('button', { name: 'Save' }))
    await screen.findByText('Collection created')
    expect((await items()).filter((item) => item.title === 'Once')).toHaveLength(1)
    expect(vi.mocked(createCollection)).toHaveBeenCalledTimes(2)
  })

  it('renames a parent without disturbing its children', async () => {
    const parent = await seedCollection('Inbox', null)
    const child = await seedCollection('Drafts', parent)
    const note = await seedNote('Shopping', parent)
    const before = await items()
    const user = await openApp()
    await chooseAction(user, 'Inbox', 'Edit collection')
    const dialog = await screen.findByRole('dialog', { name: 'Edit collection' })
    const title = within(dialog).getByRole('textbox', { name: 'Title' })
    expect(title).toHaveValue('Inbox')
    await user.clear(title)
    await user.type(title, 'Projects')
    await user.click(within(dialog).getByRole('button', { name: 'Slate' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved')
    const after = await items()
    expect(after.map((item) => item.id).sort()).toEqual(before.map((item) => item.id).sort())
    expect(after.find((item) => item.id === parent)).toMatchObject({ title: 'Projects', color: 'slate', parentId: null, version: 2 })
    expect(after.find((item) => item.id === child)?.parentId).toBe(parent)
    expect(after.find((item) => item.id === note)?.parentId).toBe(parent)
    await user.click(await screen.findByRole('link', { name: 'Projects, 2 items' }))
    await user.click(await screen.findByRole('link', { name: 'Drafts, 0 items' }))
    const crumbs = within(screen.getByTestId('crumbs-full'))
    expect(crumbs.getByRole('link', { name: 'Projects' })).toBeInTheDocument()
  })
})

describe('move', () => {
  it('moves a note to Scratch and updates both counts from the committed snapshot', async () => {
    const parent = await seedCollection('Inbox', null)
    const stay = await seedNote('Stays', parent)
    const goes = await seedNote('Goes', parent)
    const user = await openApp()
    await user.click(await screen.findByRole('link', { name: 'Inbox, 2 items' }))
    await chooseAction(user, 'Goes', 'Move')
    const dialog = await screen.findByRole('dialog', { name: 'Move' })
    const group = within(dialog).getByRole('radiogroup', { name: 'Destination' })
    expect(within(group).getByRole('radio', { name: 'Scratch' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Move here' })).toBeDisabled()
    await user.click(within(group).getByRole('radio', { name: 'Scratch' }))
    await user.click(within(dialog).getByRole('button', { name: 'Move here' }))
    await screen.findByText('Moved to Scratch')
    const after = await items()
    expect(after.find((item) => item.id === goes)?.parentId).toBeNull()
    expect(after.find((item) => item.id === stay)?.parentId).toBe(parent)
    expect(screen.queryByRole('link', { name: 'Goes' })).not.toBeInTheDocument()
    await user.click(screen.getAllByRole('link', { name: 'Scratch' })[0])
    expect(await screen.findByRole('link', { name: 'Inbox, 1 item' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Goes' })).toBeInTheDocument()
  })

  it('treats the current location as no change without writing', async () => {
    const parent = await seedCollection('Inbox', null)
    await seedNote('Here', parent)
    const revision = (await context()).context.expectedRevision
    const user = await openApp(`#/c/${parent}`)
    await chooseAction(user, 'Here', 'Move')
    const dialog = await screen.findByRole('dialog', { name: 'Move' })
    await user.click(within(dialog).getByRole('radio', { name: 'Inbox' }))
    await user.click(within(dialog).getByRole('button', { name: 'Move here' }))
    await screen.findByText('Already there. Nothing changed.')
    expect(moveItem).not.toHaveBeenCalled()
    expect((await context()).context.expectedRevision).toBe(revision)
  })

  it('does not offer the item, its descendants, or a cycle, and the repository also refuses', async () => {
    const parent = await seedCollection('Parent', null)
    const child = await seedCollection('Child', parent)
    const grand = await seedCollection('Grand', child)
    await seedCollection('Other', null)
    const user = await openApp()
    await chooseAction(user, 'Parent', 'Move')
    const dialog = await screen.findByRole('dialog', { name: 'Move' })
    const names = within(dialog).getAllByRole('radio').map((radio) => radio.getAttribute('aria-label'))
    expect(names).toEqual(['Scratch', 'Other'])
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(moveItem).not.toHaveBeenCalled()

    const latest = await context()
    const parentItem = latest.items.find((item) => item.id === parent)!
    const bypass = await moveItem(session, { ...latest.context, expectedVersion: parentItem.version }, parent, grand)
    expect(bypass.ok).toBe(false)
    expect((await items()).find((item) => item.id === parent)?.parentId).toBeNull()
  })

  it('refuses a move that would reach level nine and allows the eight-level boundary', async () => {
    let previous: string | null = null
    const chain: string[] = []
    for (let level = 1; level <= 7; level += 1) {
      previous = await seedCollection(`Level ${level}`, previous)
      chain.push(previous)
    }
    const subtree = await seedCollection('Subtree', null)
    await seedCollection('Subtree child', subtree)
    const user = await openApp()
    await chooseAction(user, 'Subtree', 'Move')
    const dialog = await screen.findByRole('dialog', { name: 'Move' })
    // Level 7 would put the child at level nine; level 6 puts it exactly at eight.
    const names = within(dialog).getAllByRole('radio').map((radio) => radio.getAttribute('aria-label'))
    expect(names.some((name) => name?.endsWith('Level 7'))).toBe(false)
    expect(names.some((name) => name?.endsWith('Level 6'))).toBe(true)

    const latest = await context()
    const target = latest.items.find((item) => item.id === subtree)!
    const refused = await moveItem(session, { ...latest.context, expectedVersion: target.version }, subtree, chain[6])
    expect(refused.ok).toBe(false)
    expect((await items()).find((item) => item.id === subtree)?.parentId).toBeNull()

    await user.click(within(dialog).getByRole('radio', { name: /Level 6$/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Move here' }))
    await screen.findByText(/^Moved to /)
    expect((await items()).find((item) => item.id === subtree)?.parentId).toBe(chain[5])
  })
})

describe('delete', () => {
  async function seedTree() {
    const top = await seedCollection('Archive', null)
    const mid = await seedCollection('Old', top)
    await seedNote('One', top)
    await seedNote('Two', mid)
    await seedNote('Three', mid)
    return { top, mid }
  }

  it('states the exact descendant count, and cancel writes nothing', async () => {
    await seedTree()
    const user = await openApp()
    await chooseAction(user, 'Archive', 'Delete')
    const dialog = await screen.findByRole('dialog', { name: 'Delete collection' })
    expect(dialog).toHaveTextContent('4 items')
    expect(dialog).toHaveTextContent('permanently')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(deleteItem).not.toHaveBeenCalled()
    expect(await items()).toHaveLength(5)
    expect(screen.getByRole('button', { name: 'More actions for Archive' })).toHaveFocus()

    await chooseAction(user, 'Archive', 'Delete')
    const again = await screen.findByRole('dialog', { name: 'Delete collection' })
    await user.dblClick(within(again).getByRole('button', { name: 'Delete permanently' }))
    await screen.findByText('Deleted')
    expect(await items()).toHaveLength(0)
    expect(deleteItem).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(document.activeElement).not.toBe(document.body))
    expect(document.body.contains(document.activeElement)).toBe(true)
  })

  it('confirms a note deletion without echoing content', async () => {
    const note = await seedNote('Private plan', null)
    const user = await openApp()
    await chooseAction(user, 'Private plan', 'Delete')
    const dialog = await screen.findByRole('dialog', { name: 'Delete note' })
    expect(dialog).toHaveTextContent('permanently')
    await user.click(within(dialog).getByRole('button', { name: 'Delete permanently' }))
    await screen.findByText('Deleted')
    expect((await items()).find((item) => item.id === note)).toBeUndefined()
  })

  it('asks for a fresh confirmation when another tab adds a child after the dialog opened', async () => {
    const { top } = await seedTree()
    const user = await openApp()
    await chooseAction(user, 'Archive', 'Delete')
    const dialog = await screen.findByRole('dialog', { name: 'Delete collection' })
    expect(dialog).toHaveTextContent('4 items')
    await seedNote('Late arrival', top)
    await user.click(within(dialog).getByRole('button', { name: 'Delete permanently' }))
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent(/changed/i))
    expect(await items()).toHaveLength(6)
    await waitFor(() => expect(dialog).toHaveTextContent('5 items'))
    expect(within(dialog).queryByRole('button', { name: 'Delete permanently' })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Review updated count' }))
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Delete permanently' }))
    await screen.findByText('Deleted')
    expect(await items()).toHaveLength(0)
  })

  it('shows the surviving parent with valid focus after deleting the viewed collection', async () => {
    const parent = await seedCollection('Outer', null)
    const child = await seedCollection('Inner', parent)
    await seedNote('Kept', parent)
    const user = await openApp(`#/c/${child}`)
    await user.click(await screen.findByRole('button', { name: 'More actions for Inner' }))
    const menu = await screen.findByRole('dialog', { name: 'Actions for Inner' })
    await user.click(within(menu).getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete collection' })
    expect(dialog).toHaveTextContent('empty')
    await user.click(within(dialog).getByRole('button', { name: 'Delete permanently' }))
    await screen.findByText('Deleted')
    expect(await screen.findByRole('heading', { name: 'Outer' })).toBeInTheDocument()
    expect(window.location.hash).toBe(`#/c/${parent}`)
    expect(screen.getByRole('link', { name: 'Kept' })).toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).not.toBe(document.body))
    expect(document.body.contains(document.activeElement)).toBe(true)
  })
})
