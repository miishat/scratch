import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/app/App'
import { createVault } from '../src/features/vault/crypto'
import type { CreatedVault } from '../src/features/vault/types'
import { createCollection, createNote, initializeLibrary, resetRepositoryForTests } from '../src/features/library/repository'
import { closeDatabase, deleteDatabase, useDatabaseName } from '../src/features/library/database'
import { useSearch } from '../src/features/search/useSearch'
import { makeNote } from './fixtures/library'

vi.setConfig({ testTimeout: 60000 })

const realSetTimeout = globalThis.setTimeout
const realNow = Date.now.bind(Date)
const PASSPHRASE = 'correct horse battery staple'
const SECRET_BODY = 'topsecret-body-999'
const MULTILINE = 'first line\n  second line\n'

let vault: CreatedVault
let dbName: string

beforeAll(async () => {
  vault = await createVault(PASSPHRASE)
}, 30000)

beforeEach(async () => {
  dbName = `scratch-search-${crypto.randomUUID()}`
  useDatabaseName(dbName)
  resetRepositoryForTests()
  window.history.replaceState(null, '', '#/')
  const init = await initializeLibrary(vault)
  if (!init.ok) throw new Error(init.message)
  let revision = init.snapshot.meta.revision
  const ctx = () => ({ generation: init.session.generation, expectedRevision: revision })
  const folder = await createCollection(init.session, ctx(), { parentId: null, title: 'Projects', color: 'sage' })
  if (!folder.ok) throw new Error(folder.message)
  revision = folder.snapshot.meta.revision
  const parentId = folder.snapshot.items.find((item) => item.title === 'Projects')!.id
  for (const input of [
    { parentId, title: 'Alpha', body: 'garden-token plans', isSecret: false },
    { parentId: null, title: 'Vault key', body: SECRET_BODY, isSecret: true },
    { parentId: null, title: 'Lines', body: MULTILINE, isSecret: false },
  ]) {
    const made = await createNote(init.session, ctx(), input)
    if (!made.ok) throw new Error(made.message)
    revision = made.snapshot.meta.revision
  }
})

afterEach(async () => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'clipboard')
  await closeDatabase()
  await deleteDatabase(dbName)
  resetRepositoryForTests()
  localStorage.clear()
  sessionStorage.clear()
})

async function until(check: () => void, limit = 30000): Promise<void> {
  const started = realNow()
  for (;;) {
    try {
      check()
      return
    } catch (error) {
      if (realNow() - started > limit) throw error
    }
    await act(async () => {
      await new Promise<void>((resolve) => realSetTimeout(resolve, 10))
    })
  }
}

async function unlock(): Promise<void> {
  await until(() => screen.getByLabelText('Passphrase'))
  fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: PASSPHRASE } })
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
  await until(() => expect(screen.getByText('Projects')).toBeInTheDocument())
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
}

function typeSearch(value: string): void {
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), { target: { value } })
}

function advance(ms: number): void {
  act(() => { vi.advanceTimersByTime(ms) })
}

const status = () => screen.getAllByRole('status').map((node) => node.textContent).join('|')

describe('header search', () => {
  it('waits 150 ms, lists results with parent paths, and restores the collection on an empty query', async () => {
    render(<App />)
    await unlock()
    typeSearch('GARDEN')
    advance(149)
    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument()
    advance(1)
    const results = screen.getByRole('list', { name: 'Search results' })
    expect(within(results).getByText('Alpha')).toBeInTheDocument()
    expect(within(results).getByText(/Projects/)).toBeInTheDocument()
    expect(status()).toContain('1 result')
    expect(window.location.hash).toBe('#/')

    typeSearch('')
    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument()
    expect(screen.getByText('Projects')).toBeVisible()
    expect(window.location.hash).toBe('#/')
  })

  it('shows No matches, never matches a secret body, and finds a secret by title', async () => {
    render(<App />)
    await unlock()
    typeSearch(SECRET_BODY)
    advance(150)
    expect(screen.getAllByText('No matches').length).toBeGreaterThan(0)
    typeSearch('vault key')
    advance(150)
    const results = screen.getByRole('list', { name: 'Search results' })
    expect(within(results).getByRole('link', { name: /Vault key/ })).toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain(SECRET_BODY)
  })

  it('opens a result through existing navigation and keeps the query out of the hash', async () => {
    render(<App />)
    await unlock()
    typeSearch('garden')
    advance(150)
    fireEvent.click(within(screen.getByRole('list', { name: 'Search results' })).getByRole('link', { name: /Alpha/ }))
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(window.location.hash).toMatch(/^#\/c\/[0-9a-f-]{36}\/n\/[0-9a-f-]{36}$/)
    expect(window.location.hash).not.toContain('garden')
    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument()
  })

  it('stops matching the old body right after a saved note is converted to Secret', async () => {
    render(<App />)
    await unlock()
    typeSearch('second line')
    advance(150)
    expect(within(screen.getByRole('list', { name: 'Search results' })).getByRole('link', { name: /Lines/ })).toBeInTheDocument()
    typeSearch('')
    fireEvent.click(screen.getByRole('link', { name: 'Lines' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Secret note' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await until(() => expect(status()).toContain('Saved'))
    typeSearch('second line')
    advance(150)
    expect(screen.getAllByText('No matches').length).toBeGreaterThan(0)
    typeSearch('lines')
    advance(150)
    expect(within(screen.getByRole('list', { name: 'Search results' })).getByRole('link', { name: /Lines, secret note/ })).toBeInTheDocument()
  })

  it('discards the query, results, and announcements when the vault locks', async () => {
    render(<App />)
    await unlock()
    typeSearch('garden')
    advance(150)
    expect(screen.getByRole('list', { name: 'Search results' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lock now' }))
    await until(() => expect(screen.getByRole('heading', { name: 'Unlock Scratch' })).toBeInTheDocument())
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/garden|result|No matches/)
    vi.useRealTimers()
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: PASSPHRASE } })
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    await until(() => expect(screen.getByText('Projects')).toBeInTheDocument())
    expect((screen.getByRole('searchbox', { name: 'Search' }) as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument()
  })
})

describe('copy on tiles', () => {
  function stubClipboard(writeText: (text: string) => Promise<void>) {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  }

  it('copies the exact body, announces Copied after it resolves, and does not navigate', async () => {
    let finish!: () => void
    const writeText = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    stubClipboard(writeText)
    render(<App />)
    await unlock()
    fireEvent.click(screen.getByRole('button', { name: 'Copy Lines' }))
    expect(writeText).toHaveBeenCalledWith(MULTILINE)
    expect(status()).not.toContain('Copied')
    await act(async () => { finish() })
    expect(status()).toContain('Copied')
    expect(window.location.hash).toBe('#/')
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('keeps the note and offers Select text when an ordinary copy is denied', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError')))
    render(<App />)
    await unlock()
    fireEvent.click(screen.getByRole('button', { name: 'Copy Lines' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(status()).not.toContain('Copied')
    expect(screen.getByRole('link', { name: 'Select text' })).toHaveAttribute('href', expect.stringMatching(/^#\/c\/root\/n\//))
    expect(screen.getByRole('link', { name: 'Lines' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/')
  })

  it('offers Reveal to copy manually for a secret and never exposes its body', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError')))
    render(<App />)
    await unlock()
    fireEvent.click(screen.getByRole('button', { name: 'Copy Vault key' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByRole('link', { name: 'Reveal to copy manually' })).toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain(SECRET_BODY)
    expect(status()).not.toContain('Copied')
  })

  it('announces Copied for a secret without the body in any announcement', async () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined))
    render(<App />)
    await unlock()
    fireEvent.click(screen.getByRole('button', { name: 'Copy Vault key' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(status()).toContain('Copied')
    expect(document.body.innerHTML).not.toContain(SECRET_BODY)
  })
})

describe('useSearch', () => {
  it('stops matching a former ordinary body as soon as the committed snapshot has it secret', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const note = makeNote({ title: 'Wifi', body: 'router-password-xyz' })
    const { result, rerender } = renderHook(({ items }) => useSearch(items, 'route-a'), { initialProps: { items: [note] } })
    act(() => result.current.setQuery('router-password'))
    act(() => { vi.advanceTimersByTime(150) })
    expect(result.current.results?.map((hit) => hit.id)).toEqual([note.id])
    rerender({ items: [{ ...note, version: 2, isSecret: true }] })
    expect(result.current.results).toEqual([])
    expect(result.current.announcement).toBe('No matches')
  })

  it('clears everything when the library is replaced by none or the route changes', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const note = makeNote({ title: 'Wifi', body: 'router' })
    const { result, rerender } = renderHook(
      ({ items, route }: { items: typeof note[] | undefined, route: string }) => useSearch(items, route),
      { initialProps: { items: [note] as typeof note[] | undefined, route: 'a' } },
    )
    act(() => result.current.setQuery('router'))
    act(() => { vi.advanceTimersByTime(150) })
    expect(result.current.results).toHaveLength(1)
    rerender({ items: [note], route: 'b' })
    expect(result.current.query).toBe('')
    expect(result.current.results).toBeNull()
    act(() => result.current.setQuery('router'))
    rerender({ items: undefined, route: 'b' })
    expect(result.current.query).toBe('')
    expect(result.current.results).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})
