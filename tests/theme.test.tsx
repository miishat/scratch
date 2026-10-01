import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useTheme, ThemeProvider } from '../src/features/theme/ThemeProvider'
import { resolveTheme, readThemePreference } from '../src/features/theme/theme'
import { App, AppShell } from '../src/app/App'
import { Dialog } from '../src/components/Dialog'
import { missingRequiredApis } from '../src/features/support/requiredApis'
import { StorageUnavailableScreen, UnsupportedBrowserScreen } from '../src/features/support/SupportScreens'
import { readFileSync } from 'node:fs'
import { useState } from 'react'

let dark = true
const listeners = new Set<(event: MediaQueryListEvent) => void>()

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  dark = true
  listeners.clear()
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    get matches() { return dark }, media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
  })))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function switchOs(value: boolean) {
  act(() => {
    dark = value
    listeners.forEach(listener => listener({ matches: value } as MediaQueryListEvent))
  })
}

function ThemeProbe() {
  const { preference, resolvedTheme, setPreference } = useTheme()
  return <><output>{preference}:{resolvedTheme}</output><button onClick={() => setPreference('system')}>System</button><button onClick={() => setPreference('light')}>Light</button><button onClick={() => setPreference('dark')}>Dark</button></>
}

describe('theme', () => {
  it('resolves an unset preference against a dark OS before React paints', () => {
    const html = readFileSync('index.html', 'utf8')
    const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
    expect(bootstrap).toBeDefined()
    window.eval(bootstrap!)
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(resolveTheme(readThemePreference(), true)).toBe('dark')
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>)
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(screen.getByText('system:dark')).toBeInTheDocument()
  })

  it('keeps explicit Light over dark OS and survives a provider remount', async () => {
    const user = userEvent.setup()
    const first = render(<ThemeProvider><ThemeProbe /></ThemeProvider>)
    await user.click(screen.getByRole('button', { name: 'Light' }))
    first.unmount()
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>)
    expect(screen.getByText('light:light')).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
  })

  it('responds to OS changes only for System', async () => {
    const user = userEvent.setup()
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>)
    switchOs(false)
    expect(screen.getByText('system:light')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Dark' }))
    switchOs(true)
    switchOs(false)
    expect(screen.getByText('dark:dark')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Light' }))
    switchOs(true)
    expect(screen.getByText('light:light')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'System' }))
    expect(screen.getByText('system:dark')).toBeInTheDocument()
  })

  it('renders the shell with system theme when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    render(<ThemeProvider><AppShell /></ThemeProvider>)
    expect(screen.getByRole('heading', { name: 'A place for the little things.' })).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    vi.restoreAllMocks()
  })
})

it('traps dialog focus and restores it to its trigger', async () => {
  const user = userEvent.setup()
  function Fixture() {
    const [open, setOpen] = useState(false)
    return <><button onClick={() => setOpen(true)}>Open</button>{open && <Dialog title="Named dialog" onRequestClose={() => setOpen(false)} canClose={() => true}><button>Inside</button></Dialog>}</>
  }
  render(<Fixture />)
  await user.click(screen.getByRole('button', { name: 'Open' }))
  expect(screen.getByRole('dialog', { name: 'Named dialog' })).toContainElement(document.activeElement as HTMLElement)
  await user.tab()
  expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
  await user.keyboard('{Escape}')
  expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus()
})

it('contains focus that escapes to the page, forward and reverse', async () => {
  const user = userEvent.setup()
  function Fixture() {
    const [open, setOpen] = useState(false)
    return <>
      <button onClick={() => setOpen(true)}>Open</button>
      <button>Outside</button>
      {open && <Dialog title="Named dialog" onRequestClose={() => setOpen(false)} canClose={() => true}><button>First</button><button>Second</button></Dialog>}
    </>
  }
  render(<Fixture />)
  await user.click(screen.getByRole('button', { name: 'Open' }))
  const dialog = screen.getByRole('dialog', { name: 'Named dialog' })
  const outside = screen.getByRole('button', { name: 'Outside' })

  outside.focus()
  expect(dialog).toContainElement(document.activeElement as HTMLElement)
  await user.tab()
  expect(dialog).toContainElement(document.activeElement as HTMLElement)

  outside.focus()
  await user.tab({ shift: true })
  expect(dialog).toContainElement(document.activeElement as HTMLElement)
})

it('wraps focus at the dialog boundaries in both directions', async () => {
  const user = userEvent.setup()
  function Fixture() {
    const [open, setOpen] = useState(false)
    return <><button onClick={() => setOpen(true)}>Open</button>{open && <Dialog title="Named dialog" onRequestClose={() => setOpen(false)} canClose={() => true}><button>First</button><button>Second</button></Dialog>}</>
  }
  render(<Fixture />)
  await user.click(screen.getByRole('button', { name: 'Open' }))
  const close = screen.getByRole('button', { name: 'Close dialog' })
  const second = screen.getByRole('button', { name: 'Second' })

  second.focus()
  await user.tab()
  expect(close).toHaveFocus()

  close.focus()
  await user.tab({ shift: true })
  expect(second).toHaveFocus()
})

it('honors the close permission before closing', async () => {
  const user = userEvent.setup()
  function Fixture() {
    const [open, setOpen] = useState(false)
    return <><button onClick={() => setOpen(true)}>Open</button>{open && <Dialog title="Named dialog" onRequestClose={() => setOpen(false)} canClose={() => false}><button>First</button></Dialog>}</>
  }
  render(<Fixture />)
  await user.click(screen.getByRole('button', { name: 'Open' }))
  await user.keyboard('{Escape}')
  expect(screen.getByRole('dialog', { name: 'Named dialog' })).toBeInTheDocument()
})

it('renders an SVG close icon with an accessible name', async () => {
  const user = userEvent.setup()
  function Fixture() {
    const [open, setOpen] = useState(false)
    return <><button onClick={() => setOpen(true)}>Open</button>{open && <Dialog title="Named dialog" onRequestClose={() => setOpen(false)} canClose={() => true}><button>First</button></Dialog>}</>
  }
  render(<Fixture />)
  await user.click(screen.getByRole('button', { name: 'Open' }))
  const close = screen.getByRole('button', { name: 'Close dialog' })
  expect(close.querySelector('svg')).toBeInTheDocument()
})

it('exposes reachable Add and Settings controls in the narrow shell', async () => {
  render(<ThemeProvider><AppShell onAddNote={() => {}} onAddCollection={() => {}} /></ThemeProvider>)
  expect(screen.getByRole('button', { name: 'Add' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Settings' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Add note' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Add collection' })).toBeVisible()
})

it('lists missing required browser APIs and shows them on the unsupported screen', () => {
  vi.stubGlobal('Intl', { ...Intl, Segmenter: undefined })
  const missing = missingRequiredApis()
  expect(missing).toContain('Intl.Segmenter')
  render(<UnsupportedBrowserScreen missingApis={missing} />)
  expect(screen.getByText(/Intl.Segmenter/)).toBeInTheDocument()
})

it('gates the shell when a required API is missing', () => {
  vi.stubGlobal('indexedDB', undefined)
  render(<ThemeProvider><App /></ThemeProvider>)
  expect(screen.getByRole('heading', { name: 'Browser not supported' })).toBeInTheDocument()
  expect(screen.getByText(/IndexedDB/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
})

it('offers a retry when browser storage is unavailable', async () => {
  const retry = vi.fn()
  render(<StorageUnavailableScreen onRetry={retry} />)
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))
  expect(retry).toHaveBeenCalledOnce()
})
