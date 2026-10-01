import { useEffect, useState, type ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatRoute, parseHash, resolveRoute } from '../src/app/navigation'
import { NavigationProvider } from '../src/app/NavigationProvider'
import { useNavigation, type NavigationGuard } from '../src/app/useNavigation'
import { AppHeader } from '../src/components/AppHeader'
import { CollectionView } from '../src/features/collections/CollectionView'
import type { LibraryItem } from '../src/features/library/types'
import { fixtureIds, fixtureLibrary, fixtureSecretBody, makeCollection, makeNote } from './fixtures/library'

const ids = fixtureIds

function Harness({ items, children, ...props }: { items: LibraryItem[], children?: ReactNode } & Partial<Parameters<typeof CollectionView>[0]>) {
  return <NavigationProvider items={items}>
    {children}
    <CollectionView
      items={items}
      renderNote={(note) => <div data-testid="note-open">{note.id}|{note.body}</div>}
      {...props}
    />
  </NavigationProvider>
}

// History traversal and popstate are asynchronous in jsdom.
async function traverse(action: () => void) {
  await act(async () => {
    action()
    await new Promise((resolve) => setTimeout(resolve, 120))
  })
}

beforeEach(() => {
  window.history.replaceState(null, '', '#/')
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('route parsing', () => {
  it('formats and parses only id based routes', () => {
    expect(formatRoute({ collectionId: null })).toBe('#/')
    expect(formatRoute({ collectionId: ids.apiTokens })).toBe(`#/c/${ids.apiTokens}`)
    expect(formatRoute({ collectionId: ids.apiTokens, noteId: ids.openai })).toBe(`#/c/${ids.apiTokens}/n/${ids.openai}`)
    expect(formatRoute({ collectionId: null, noteId: ids.welcome })).toBe(`#/c/root/n/${ids.welcome}`)
    expect(parseHash(`#/c/root/n/${ids.welcome}`)).toEqual({ valid: true, route: { collectionId: null, noteId: ids.welcome } })
    for (const empty of ['', '#', '#/']) expect(parseHash(empty)).toEqual({ valid: true, route: { collectionId: null } })
  })

  it.each([
    '#/c/not-a-uuid',
    `#/c/${ids.apiTokens}/n/nope`,
    `#/c/${ids.apiTokens}/n`,
    `#/c/${ids.apiTokens}/extra`,
    `#/c/${ids.apiTokens}/n/${ids.openai}/more`,
    '#/c/root',
    '#/n/' + ids.openai,
    '#/c/Hello%20world',
    '#/search/secret',
  ])('rejects %s as malformed', (hash) => {
    expect(parseHash(hash)).toEqual({ valid: false, route: { collectionId: null } })
  })

  it('walks known ancestry to the nearest existing collection', () => {
    const items = fixtureLibrary.filter((item) => item.id !== ids.reminders)
    const known = new Map<string, string | null>([[ids.reminders, ids.personal], [ids.personal, null]])
    expect(resolveRoute({ collectionId: ids.reminders }, items, known).route).toEqual({ collectionId: ids.personal })
    expect(resolveRoute({ collectionId: ids.reminders }, items).route).toEqual({ collectionId: null })
    const noParents = fixtureLibrary.filter((item) => item.id !== ids.reminders && item.id !== ids.personal)
    expect(resolveRoute({ collectionId: ids.reminders }, noParents, known).route).toEqual({ collectionId: null })
  })
})

describe('collection navigation', () => {
  it('opens API Tokens then OpenAI by id', async () => {
    const user = userEvent.setup()
    render(<Harness items={fixtureLibrary} />)
    await user.click(screen.getByRole('link', { name: 'API Tokens, 2 items' }))
    expect(window.location.hash).toBe(`#/c/${ids.apiTokens}`)
    expect(screen.getByRole('heading', { level: 1, name: 'API Tokens' })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /^OpenAI/ }))
    expect(window.location.hash).toBe(`#/c/${ids.apiTokens}/n/${ids.openai}`)
    expect(screen.getByTestId('note-open')).toHaveTextContent(ids.openai)
  })

  it('restores the previous grid and note route with Back and Forward', async () => {
    const user = userEvent.setup()
    render(<Harness items={fixtureLibrary} />)
    await user.click(screen.getByRole('link', { name: 'API Tokens, 2 items' }))
    await user.click(screen.getByRole('link', { name: /^OpenAI/ }))
    await traverse(() => window.history.back())
    expect(window.location.hash).toBe(`#/c/${ids.apiTokens}`)
    expect(screen.queryByTestId('note-open')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^OpenAI/ })).toBeInTheDocument()
    await traverse(() => window.history.back())
    expect(window.location.hash).toBe('#/')
    expect(screen.getByRole('link', { name: 'Personal, 1 item' })).toBeInTheDocument()
    await traverse(() => window.history.forward())
    await traverse(() => window.history.forward())
    expect(window.location.hash).toBe(`#/c/${ids.apiTokens}/n/${ids.openai}`)
    expect(screen.getByTestId('note-open')).toHaveTextContent(ids.openai)
  })

  it.each([
    '#/c/not-a-uuid',
    '#/c/Hello%20world',
    `#/c/${ids.apiTokens}/n/zzz`,
  ])('falls back safely from the invalid hash %s', (hash) => {
    window.history.replaceState(null, '', hash)
    render(<Harness items={fixtureLibrary} />)
    expect(screen.getByRole('status')).toHaveTextContent(/could not be opened/i)
    expect(screen.getByRole('link', { name: 'API Tokens, 2 items' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/')
  })

  it('falls back to home for a deleted collection and a deleted note', () => {
    window.history.replaceState(null, '', '#/c/99999999-9999-4999-8999-999999999999')
    const { unmount } = render(<Harness items={fixtureLibrary} />)
    expect(screen.getByRole('status')).toHaveTextContent(/no longer available/i)
    expect(window.location.hash).toBe('#/')
    unmount()
    window.history.replaceState(null, '', `#/c/${ids.apiTokens}/n/99999999-9999-4999-8999-999999999999`)
    render(<Harness items={fixtureLibrary} />)
    expect(screen.getByRole('status')).toHaveTextContent(/no longer available/i)
    expect(window.location.hash).toBe(`#/c/${ids.apiTokens}`)
    expect(screen.getByRole('heading', { level: 1, name: 'API Tokens' })).toBeInTheDocument()
  })

  it('moves to the nearest surviving ancestor when the open collection is deleted', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Harness items={fixtureLibrary} />)
    await user.click(screen.getByRole('link', { name: 'Personal, 1 item' }))
    await user.click(screen.getByRole('link', { name: 'Reminders, 0 items' }))
    expect(window.location.hash).toBe(`#/c/${ids.reminders}`)
    rerender(<Harness items={fixtureLibrary.filter((item) => item.id !== ids.reminders)} />)
    expect(screen.getByRole('status')).toHaveTextContent(/no longer available/i)
    expect(window.location.hash).toBe(`#/c/${ids.personal}`)
    expect(screen.getByRole('heading', { level: 1, name: 'Personal' })).toBeInTheDocument()
  })

  it('counts every immediate child, not only notes', async () => {
    const parent = makeCollection({ title: 'Mixed', color: 'ochre' })
    const items = [
      parent,
      makeCollection({ title: 'Inner', color: 'slate', parentId: parent.id }),
      makeNote({ title: 'Leaf', body: 'leaf', parentId: parent.id }),
      makeNote({ title: 'Deep', body: 'deep', parentId: parent.id }),
    ]
    items.push(makeNote({ title: 'Grandchild', body: 'x', parentId: items[1].id }))
    render(<Harness items={items} />)
    expect(screen.getByRole('link', { name: 'Mixed, 3 items' })).toBeInTheDocument()
    const solo = makeCollection({ title: 'Solo', color: 'sage' })
    render(<Harness items={[solo, makeNote({ title: 'Only', body: 'o', parentId: solo.id })]} />)
    expect(screen.getByRole('link', { name: 'Solo, 1 item' })).toBeInTheDocument()
  })

  it('orders collections first and uses each item identity for duplicate titles', async () => {
    const user = userEvent.setup()
    render(<Harness items={fixtureLibrary} />)
    const tiles = screen.getAllByRole('listitem').map((tile) => within(tile).getAllByRole('link')[0].getAttribute('aria-label'))
    expect(tiles.slice(0, 2)).toEqual(['API Tokens, 2 items', 'Personal, 1 item'])
    expect(tiles).toHaveLength(5)
    const duplicates = screen.getAllByRole('link', { name: 'Shared title' })
    expect(duplicates).toHaveLength(2)
    await user.click(duplicates[1])
    expect(screen.getByTestId('note-open')).toHaveTextContent(`${ids.duplicateB}|Body of the second duplicate.`)
    await traverse(() => window.history.back())
    await user.click(screen.getAllByRole('link', { name: 'Shared title' })[0])
    expect(screen.getByTestId('note-open')).toHaveTextContent(`${ids.duplicateA}|Body of the first duplicate.`)
  })
})

describe('tiles', () => {
  it('keeps Copy and menu controls separate from the open link', async () => {
    const user = userEvent.setup()
    const onCopyNote = vi.fn()
    const onItemMenu = vi.fn()
    render(<Harness items={fixtureLibrary} onCopyNote={onCopyNote} onItemMenu={onItemMenu} />)
    const copy = screen.getAllByRole('button', { name: 'Copy Shared title' })[0]
    const menu = screen.getAllByRole('button', { name: 'More actions for Shared title' })[0]
    expect(copy.closest('a')).toBeNull()
    expect(menu.closest('a')).toBeNull()
    copy.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onCopyNote).toHaveBeenCalledTimes(2)
    menu.focus()
    await user.keyboard('{Enter}')
    expect(onItemMenu).toHaveBeenCalledTimes(1)
    expect(window.location.hash).toBe('#/')
    expect(screen.queryByTestId('note-open')).not.toBeInTheDocument()
  })

  it('shows eight dots for a secret note and never its body', () => {
    window.history.replaceState(null, '', `#/c/${ids.apiTokens}`)
    render(<Harness items={fixtureLibrary} />)
    const link = screen.getByRole('link', { name: /^OpenAI/ })
    expect(within(link).getByText('•'.repeat(8))).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(fixtureSecretBody)
    expect(document.body.innerHTML).not.toContain(fixtureSecretBody)
  })

  it('does not derive a title from a secret body', () => {
    const secret = makeNote({ body: 'derived-from-body-xyz', isSecret: true })
    render(<Harness items={[secret]} />)
    expect(document.body).not.toHaveTextContent('derived-from-body-xyz')
    expect(screen.getByRole('link', { name: /Untitled secret note/ })).toBeInTheDocument()
  })

  it('shows a body preview and derived title for an ordinary note', () => {
    render(<Harness items={fixtureLibrary} />)
    const link = screen.getByRole('link', { name: 'First line of the note.' })
    expect(within(link).getByText(/Second line with a unicode/)).toBeInTheDocument()
  })

  it('names collection colors and icons without relying on color', () => {
    render(<Harness items={fixtureLibrary} />)
    const tile = screen.getByRole('link', { name: 'API Tokens, 2 items' }).closest('li')
    expect(tile).toHaveAttribute('data-color', 'sage')
    expect(tile?.querySelector('svg')).toBeInTheDocument()
  })

  it('keeps 80 cluster and unbroken titles inside the tile with a full label', () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}'.repeat(80)
    const unbroken = 'W'.repeat(80)
    const items = [makeCollection({ title: family, color: 'clay' }), makeNote({ title: unbroken, body: 'b' })]
    render(<Harness items={items} />)
    expect(screen.getByRole('link', { name: `${family}, 0 items` })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: unbroken })).toBeInTheDocument()
    const css = readFileSync('src/app/global.css', 'utf8')
    const rule = css.match(/\.tile-title\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/)
    expect(rule).toMatch(/-webkit-line-clamp/)
    expect(css).toMatch(/\.tile-grid\s*>\s*\.tile\s*\{[^}]*min-width:\s*0/)
  })
})

describe('breadcrumbs', () => {
  it('shows the full ancestry on desktop and a shortened one with an ancestor menu on mobile', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', `#/c/${ids.reminders}`)
    render(<Harness items={fixtureLibrary} />)
    const full = screen.getByTestId('crumbs-full')
    expect(within(full).getByRole('link', { name: 'Scratch' })).toHaveAttribute('href', '#/')
    expect(within(full).getByRole('link', { name: 'Personal' })).toHaveAttribute('href', `#/c/${ids.personal}`)
    expect(within(full).getByText('Reminders')).toHaveAttribute('aria-current', 'page')
    const short = screen.getByTestId('crumbs-short')
    expect(within(short).getByRole('link', { name: 'Back to Personal' })).toHaveAttribute('href', `#/c/${ids.personal}`)
    const toggle = within(short).getByRole('button', { name: 'Show ancestors' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await user.click(within(short).getByRole('link', { name: 'Personal' }))
    expect(window.location.hash).toBe(`#/c/${ids.personal}`)
    expect(screen.getByRole('heading', { level: 1, name: 'Personal' })).toBeInTheDocument()
  })

  it('closes the ancestor menu with Escape and returns focus', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', `#/c/${ids.reminders}`)
    render(<Harness items={fixtureLibrary} />)
    const toggle = within(screen.getByTestId('crumbs-short')).getByRole('button', { name: 'Show ancestors' })
    await user.click(toggle)
    await user.keyboard('{Escape}')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
  })
})

describe('empty and creation entry points', () => {
  it('wires empty actions to the creation callbacks with the current parent', async () => {
    const user = userEvent.setup()
    const onAddNote = vi.fn()
    const onAddCollection = vi.fn()
    const parent = makeCollection({ title: 'Empty one', color: 'slate' })
    window.history.replaceState(null, '', `#/c/${parent.id}`)
    render(<Harness items={[parent]} onAddNote={onAddNote} onAddCollection={onAddCollection} />)
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    await user.click(screen.getByRole('button', { name: 'Add collection' }))
    expect(onAddNote).toHaveBeenCalledWith(parent.id)
    expect(onAddCollection).toHaveBeenCalledWith(parent.id)
  })

  it('shows the library empty state at the root', () => {
    render(<Harness items={[]} onAddNote={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'A place for the little things.' })).toBeInTheDocument()
  })
})

describe('dirty editor guard', () => {
  function GuardProbe({ guard }: { guard: NavigationGuard }) {
    const { registerGuard } = useNavigation()
    useEffect(() => registerGuard(guard), [guard, registerGuard])
    return null
  }

  it('blocks tile navigation while the guard refuses, then allows it', async () => {
    const user = userEvent.setup()
    const guard = vi.fn<NavigationGuard>(() => false)
    render(<Harness items={fixtureLibrary}><GuardProbe guard={guard} /></Harness>)
    await user.click(screen.getByRole('link', { name: 'API Tokens, 2 items' }))
    expect(guard).toHaveBeenCalledTimes(1)
    expect(window.location.hash).toBe('#/')
    expect(screen.getByRole('link', { name: 'Personal, 1 item' })).toBeInTheDocument()
    guard.mockImplementation(async () => true)
    await user.click(screen.getByRole('link', { name: 'API Tokens, 2 items' }))
    expect(window.location.hash).toBe(`#/c/${ids.apiTokens}`)
  })

  it('restores the URL when Back is refused and honours Back once unregistered', async () => {
    const user = userEvent.setup()
    const guard = vi.fn<NavigationGuard>(() => false)
    function Toggle() {
      const [on, setOn] = useState(true)
      return <>
        <button type="button" onClick={() => setOn(false)}>release</button>
        {on && <GuardProbe guard={guard} />}
      </>
    }
    render(<Harness items={fixtureLibrary}><Toggle /></Harness>)
    guard.mockImplementation(() => true)
    await user.click(screen.getByRole('link', { name: 'API Tokens, 2 items' }))
    await user.click(screen.getByRole('link', { name: /^OpenAI/ }))
    guard.mockImplementation(() => false)
    await traverse(() => window.history.back())
    expect(guard).toHaveBeenCalled()
    expect(window.location.hash).toBe(`#/c/${ids.apiTokens}/n/${ids.openai}`)
    expect(screen.getByTestId('note-open')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'release' }))
    await traverse(() => window.history.back())
    expect(window.location.hash).toBe(`#/c/${ids.apiTokens}`)
    expect(screen.queryByTestId('note-open')).not.toBeInTheDocument()
  })

  it('lets a guard confirm asynchronously', async () => {
    const user = userEvent.setup()
    let release: (allow: boolean) => void = () => undefined
    const guard: NavigationGuard = () => new Promise<boolean>((resolve) => { release = resolve })
    render(<Harness items={fixtureLibrary}><GuardProbe guard={guard} /></Harness>)
    await user.click(screen.getByRole('link', { name: 'API Tokens, 2 items' }))
    expect(window.location.hash).toBe('#/')
    await act(async () => { release(true) })
    await waitFor(() => expect(window.location.hash).toBe(`#/c/${ids.apiTokens}`))
  })
})

describe('Add menu', () => {
  it('opens a menu of wired creation actions and closes with Escape', async () => {
    const user = userEvent.setup()
    const onAddNote = vi.fn()
    const onAddCollection = vi.fn()
    render(<AppHeader onAddNote={onAddNote} onAddCollection={onAddCollection} />)
    const add = screen.getByRole('button', { name: 'Add' })
    expect(screen.queryByRole('button', { name: 'Add note' })).not.toBeInTheDocument()
    await user.click(add)
    expect(add).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')
    expect(add).toHaveAttribute('aria-expanded', 'false')
    expect(add).toHaveFocus()
    await user.click(add)
    await user.click(screen.getByRole('button', { name: 'Add collection' }))
    expect(onAddCollection).toHaveBeenCalledTimes(1)
    await user.click(add)
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    expect(onAddNote).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Add note' })).not.toBeInTheDocument()
  })

  it('disables Add while no creation action is wired', () => {
    render(<AppHeader />)
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })
})
