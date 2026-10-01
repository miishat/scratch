import { useEffect, useRef, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/app/App'
import { useVault } from '../src/features/vault/VaultProvider'
import { useLibrary } from '../src/features/library/LibraryProvider'
import { createVault } from '../src/features/vault/crypto'
import * as crypto_ from '../src/features/vault/crypto'
import type { CipherEnvelope, CreatedVault } from '../src/features/vault/types'
import type { MutationResult } from '../src/features/library/types'
import {
  changePassphrase,
  createNote,
  initializeLibrary,
  readHeader,
  readStoredSnapshot,
  replaceLibrary,
  resetRepositoryForTests,
} from '../src/features/library/repository'
import { closeDatabase, deleteDatabase, useDatabaseName } from '../src/features/library/database'

// Lifecycle cases for the in-memory vault session. Time is faked (setTimeout and
// Date only) and visibility transitions are explicit. Async crypto and storage
// settle on real timers, so waiting uses the captured real setTimeout.

vi.mock('../src/features/vault/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/vault/crypto')>()
  return {
    ...actual,
    sealEnvelope: vi.fn(actual.sealEnvelope),
    unlockVault: vi.fn(actual.unlockVault),
    rewrapVault: vi.fn(actual.rewrapVault),
  }
})

// PBKDF2 at 600,000 iterations makes each unlock take real time.
vi.setConfig({ testTimeout: 60000 })

const actualRewrap = (...args: Parameters<typeof crypto_.rewrapVault>) =>
  vi.importActual<typeof import('../src/features/vault/crypto')>('../src/features/vault/crypto').then((m) => m.rewrapVault(...args))

const realSetTimeout = globalThis.setTimeout
const realNow = Date.now.bind(Date)
const PASSPHRASE = 'correct horse battery staple'
const NEW_PASSPHRASE = 'a brand new long passphrase'
const NOTE_TITLE = 'Visible library note'
const DRAFT_TEXT = 'unsaved draft marker text'
const MINUTE = 60_000

let vault: CreatedVault
let dbName: string
let readFails = false

const renderLog: { concealed: boolean; titles: string[] }[] = []
const spies = {
  save: vi.fn<() => Promise<MutationResult>>(),
  discard: vi.fn(),
  cancel: vi.fn(),
  exportRecovery: vi.fn(),
}

beforeAll(async () => {
  vault = await createVault(PASSPHRASE)
}, 30000)

beforeEach(() => {
  dbName = `scratch-vault-session-${crypto.randomUUID()}`
  useDatabaseName(dbName)
  resetRepositoryForTests()
  renderLog.length = 0
  readFails = false
  spies.save.mockReset()
  spies.discard.mockReset()
  spies.cancel.mockReset()
  spies.exportRecovery.mockReset()
  spies.save.mockResolvedValue({ ok: false, code: 'unavailable', message: 'not wired' })
  spies.exportRecovery.mockResolvedValue(undefined)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
})

afterEach(async () => {
  cleanup()
  vi.useRealTimers()
  setVisibility(false)
  delete (document as unknown as Record<string, unknown>).hidden
  delete (document as unknown as Record<string, unknown>).visibilityState
  await closeDatabase()
  await deleteDatabase(dbName)
  resetRepositoryForTests()
  localStorage.clear()
  sessionStorage.clear()
  vi.mocked(crypto_.sealEnvelope).mockClear()
  vi.mocked(crypto_.unlockVault).mockClear()
  vi.mocked(crypto_.rewrapVault).mockClear()
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

async function seedLibrary(): Promise<void> {
  const init = await initializeLibrary(vault)
  if (!init.ok) throw new Error(init.message)
  const result = await createNote(
    init.session,
    { generation: init.session.generation, expectedRevision: init.snapshot.meta.revision },
    { parentId: null, title: NOTE_TITLE, body: 'body', isSecret: false },
  )
  if (!result.ok) throw new Error(result.message)
}

function setVisibility(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') })
}

function transitionVisibility(hidden: boolean): void {
  act(() => {
    setVisibility(hidden)
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

// Move the clock without firing timers, the way a backgrounded phone resumes.
function jumpClock(ms: number): void {
  vi.setSystemTime(Date.now() + ms)
}

function Probe() {
  const library = useLibrary()
  const vaultContext = useVault()
  const titles = library.snapshot?.items.map((item) => item.title ?? '') ?? []
  const key = titles.join('|')
  useEffect(() => {
    renderLog.push({ concealed: vaultContext.concealed, titles: key ? key.split('|') : [] })
  })
  return <ul aria-label="library">{titles.map((title) => <li key={title}>{title}</li>)}</ul>
}

// Stands in for the Task 6 editor: it registers a dirty draft once text exists.
function FakeEditor() {
  const vaultContext = useVault()
  const { registerDraft } = vaultContext
  const [text, setText] = useState(() => vaultContext.recoveredDraft?.input.body ?? '')
  const textRef = useRef(text)
  const dirty = text !== ''
  useEffect(() => {
    textRef.current = text
  }, [text])
  useEffect(() => {
    if (!dirty) return
    return registerDraft({
      read: () => {
        if (readFails) throw new Error('read failed')
        return { noteId: null, input: { parentId: null, title: null, body: textRef.current, isSecret: false } }
      },
      save: () => spies.save(),
      discard: () => {
        spies.discard()
        setText('')
      },
      cancel: () => spies.cancel(),
    })
  }, [dirty, registerDraft])
  return <textarea aria-label="Draft" value={text} onChange={(event) => setText(event.target.value)} />
}

function renderApp(withEditor = false) {
  return render(
    <App exportRecoveryBackup={spies.exportRecovery}>
      <Probe />
      {withEditor && <FakeEditor />}
    </App>,
  )
}

// userEvent cannot be used here: its async wrapper waits on a faked setTimeout,
// which vitest does not advance for it. fireEvent is synchronous and sufficient.
const typing = () => ({
  type: async (element: HTMLElement, text: string) => {
    const field = element as HTMLInputElement | HTMLTextAreaElement
    fireEvent.change(field, { target: { value: field.value + text } })
  },
  clear: async (element: HTMLElement) => {
    fireEvent.change(element, { target: { value: '' } })
  },
  click: async (element: HTMLElement) => {
    fireEvent.click(element)
  },
})

async function unlockThroughUi(user: ReturnType<typeof typing>, passphrase = PASSPHRASE): Promise<void> {
  await until(() => screen.getByLabelText('Passphrase'))
  await user.type(screen.getByLabelText('Passphrase'), passphrase)
  await user.click(screen.getByRole('button', { name: 'Unlock' }))
}

async function unlockAndWaitForLibrary(user: ReturnType<typeof typing>): Promise<void> {
  await unlockThroughUi(user)
  await until(() => expect(screen.getByText(NOTE_TITLE)).toBeInTheDocument())
}

async function openLockFromSettings(user: ReturnType<typeof typing>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Settings' }))
  await user.click(screen.getByRole('button', { name: 'Lock now' }))
}

async function typeDraft(user: ReturnType<typeof typing>): Promise<void> {
  await user.type(screen.getByLabelText('Draft'), DRAFT_TEXT)
}

// Another tab replaced the whole library: same key, new generation.
async function replaceLibraryElsewhere(): Promise<void> {
  const init = await readHeader()
  if (!init.ok || init.library !== 'present') throw new Error('expected a library')
  const session = { header: init.header.header, generation: init.header.meta.generation, dataKey: vault.dataKey }
  const result = await replaceLibrary(session, { expectedGeneration: session.generation, expectedRevision: init.header.meta.revision }, [])
  if (!result.ok) throw new Error(result.message)
  const channel = new BroadcastChannel('scratch-v1-changes')
  channel.postMessage({ vaultId: session.header.vaultId, generation: result.snapshot.meta.generation, revision: result.snapshot.meta.revision })
  channel.close()
}

function expectUnlockScreen(): void {
  expect(screen.getByRole('heading', { name: 'Unlock Scratch' })).toBeInTheDocument()
}

describe('vault session lifecycle', () => {
  it('creates one empty vault from a confirmed passphrase and reaches Scratch', async () => {
    const user = typing()
    render(<App />)
    await until(() => screen.getByLabelText('Passphrase'))
    await user.type(screen.getByLabelText('Passphrase'), PASSPHRASE)
    await user.type(screen.getByLabelText('Confirm passphrase'), PASSPHRASE)
    await user.click(screen.getByRole('button', { name: 'Create vault' }))
    await until(() =>
      expect(screen.getByRole('heading', { name: 'A place for the little things.' })).toBeInTheDocument(),
    )
    const stored = await readStoredSnapshot()
    expect(stored.ok && stored.snapshot.items).toHaveLength(0)
    const header = await readHeader()
    expect(header.ok && header.library).toBe('present')
  })

  it('rejects a mismatched confirmation without creating a vault', async () => {
    const user = typing()
    renderApp()
    await until(() => screen.getByLabelText('Passphrase'))
    await user.type(screen.getByLabelText('Passphrase'), PASSPHRASE)
    await user.type(screen.getByLabelText('Confirm passphrase'), 'something else entirely')
    await user.click(screen.getByRole('button', { name: 'Create vault' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Passphrases do not match')
    const header = await readHeader()
    expect(header.ok && header.library).toBe('absent')
  })

  it('offers Import backup on setup and lets a supplied handler take over', async () => {
    const onImportBackup = vi.fn()
    render(<App onImportBackup={onImportBackup} />)
    await until(() => screen.getByRole('button', { name: 'Import backup' }))
    await typing().click(screen.getByRole('button', { name: 'Import backup' }))
    expect(onImportBackup).toHaveBeenCalledTimes(1)
    cleanup()
    render(<App />)
    // Without an override the app wires its own import dialog.
    await until(() => screen.getByRole('button', { name: 'Import backup' }))
    await typing().click(screen.getByRole('button', { name: 'Import backup' }))
    expect(screen.getByRole('dialog', { name: 'Import backup' })).toBeInTheDocument()
  })

  it('keeps the vault locked and the records unchanged after a wrong passphrase', async () => {
    await seedLibrary()
    const before = await readStoredSnapshot()
    const user = typing()
    renderApp()
    await unlockThroughUi(user, 'definitely the wrong phrase')
    await until(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not unlock this vault.'))
    expectUnlockScreen()
    expect(screen.queryByText(NOTE_TITLE)).not.toBeInTheDocument()
    expect(await readStoredSnapshot()).toEqual(before)
  })

  it('shows Unlocking progress and starts locked after a reload with no stored key', async () => {
    await seedLibrary()
    const user = typing()
    const first = renderApp()
    await unlockThroughUi(user)
    expect(screen.getByRole('status', { name: 'Unlocking' })).toBeInTheDocument()
    await until(() => expect(screen.getByText(NOTE_TITLE)).toBeInTheDocument())
    first.unmount()

    renderApp()
    await until(() => expectUnlockScreen())
    expect(screen.queryByText(NOTE_TITLE)).not.toBeInTheDocument()
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('locks before any plaintext appears when a hidden tab resumes past sixty seconds', async () => {
    await seedLibrary()
    const user = typing()
    renderApp()
    await unlockAndWaitForLibrary(user)

    transitionVisibility(true)
    expect(renderLog.at(-1)?.concealed).toBe(true)
    const markAfterHide = renderLog.length
    jumpClock(61_000)
    transitionVisibility(false)
    await until(() => expectUnlockScreen())
    const resumed = renderLog.slice(markAfterHide)
    expect(resumed.some((entry) => !entry.concealed && entry.titles.includes(NOTE_TITLE))).toBe(false)
    expect(screen.queryByText(NOTE_TITLE)).not.toBeInTheDocument()
  })

  it('locks when the hidden timer fires and stays unlocked after a short hide', async () => {
    await seedLibrary()
    const user = typing()
    renderApp()
    await unlockAndWaitForLibrary(user)

    transitionVisibility(true)
    advance(30_000)
    transitionVisibility(false)
    expect(screen.queryByRole('heading', { name: 'Unlock Scratch' })).not.toBeInTheDocument()
    expect(renderLog.at(-1)?.concealed).toBe(false)

    transitionVisibility(true)
    advance(60_000)
    await until(() => expectUnlockScreen())
  })

  it('locks after ten minutes without activity and extends the deadline on activity', async () => {
    await seedLibrary()
    const user = typing()
    renderApp()
    await unlockAndWaitForLibrary(user)

    advance(9 * MINUTE)
    fireEvent.keyDown(document, { key: 'a' })
    advance(9 * MINUTE)
    expect(screen.queryByRole('heading', { name: 'Unlock Scratch' })).not.toBeInTheDocument()
    advance(MINUTE + 1000)
    await until(() => expectUnlockScreen())
  })

  it('seals a dirty draft on automatic lock and recovers it after unlocking the same vault', async () => {
    await seedLibrary()
    const user = typing()
    renderApp(true)
    await unlockAndWaitForLibrary(user)
    await typeDraft(user)

    advance(10 * MINUTE + 1000)
    await until(() => expectUnlockScreen())
    expect(document.body.textContent).not.toContain(DRAFT_TEXT)

    const sealCalls = vi.mocked(crypto_.sealEnvelope).mock.calls
    expect(sealCalls).toHaveLength(1)
    expect(sealCalls[0][1]).toBe('draft')
    const sealed = (await vi.mocked(crypto_.sealEnvelope).mock.results[0].value) as CipherEnvelope
    expect(JSON.stringify(sealed)).not.toContain(DRAFT_TEXT)
    expect(atob(sealed.ciphertext)).not.toContain(DRAFT_TEXT)

    await unlockThroughUi(user)
    await until(() => expect(screen.getByLabelText('Draft')).toHaveValue(DRAFT_TEXT))
  })

  it('enters a concealed lock-error state instead of claiming Locked when sealing fails', async () => {
    await seedLibrary()
    vi.mocked(crypto_.sealEnvelope).mockRejectedValueOnce(new Error('encrypt failed'))
    const user = typing()
    renderApp(true)
    await unlockAndWaitForLibrary(user)
    await typeDraft(user)

    advance(10 * MINUTE + 1000)
    await until(() => expect(screen.getByRole('heading', { name: 'Could not lock Scratch' })).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: 'Unlock Scratch' })).not.toBeInTheDocument()
    expect(screen.queryByText(/^Locked$/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Draft', { selector: 'textarea' })).not.toBeVisible()
    expect(screen.queryByText(NOTE_TITLE)).not.toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Discard draft and lock' }))
    await until(() => expectUnlockScreen())
    expect(spies.discard).toHaveBeenCalledTimes(1)
  })

  it('lets lock-error recover with Save and lock', async () => {
    await seedLibrary()
    vi.mocked(crypto_.sealEnvelope).mockRejectedValueOnce(new Error('encrypt failed'))
    spies.save.mockResolvedValue({ ok: true, snapshot: undefined as never })
    const user = typing()
    renderApp(true)
    await unlockAndWaitForLibrary(user)
    await typeDraft(user)
    advance(10 * MINUTE + 1000)
    await until(() => expect(screen.getByRole('heading', { name: 'Could not lock Scratch' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Save draft and lock' }))
    await until(() => expectUnlockScreen())
    expect(spies.save).toHaveBeenCalledTimes(1)
  })

  it('leaves the editor unchanged when a manual lock is canceled', async () => {
    await seedLibrary()
    const user = typing()
    renderApp(true)
    await unlockAndWaitForLibrary(user)
    await typeDraft(user)

    await openLockFromSettings(user)
    const dialog = screen.getByRole('dialog', { name: 'Lock Scratch?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(spies.cancel).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Draft')).toHaveValue(DRAFT_TEXT)
    expect(screen.queryByRole('heading', { name: 'Unlock Scratch' })).not.toBeInTheDocument()
  })

  it('stays editable and unlocked when Save and lock fails', async () => {
    await seedLibrary()
    spies.save.mockResolvedValue({ ok: false, code: 'quota', message: 'Not enough local storage space.' })
    const user = typing()
    renderApp(true)
    await unlockAndWaitForLibrary(user)
    await typeDraft(user)

    await openLockFromSettings(user)
    await user.click(screen.getByRole('button', { name: 'Save and lock' }))
    await until(() => expect(screen.getByRole('alert')).toHaveTextContent('Not enough local storage space.'))
    expect(screen.queryByRole('heading', { name: 'Unlock Scratch' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Draft')).toBeVisible()
    expect(screen.getByLabelText('Draft')).toHaveValue(DRAFT_TEXT)
  })

  it('locks immediately from settings when there is no dirty draft', async () => {
    await seedLibrary()
    const user = typing()
    renderApp()
    await unlockAndWaitForLibrary(user)
    await openLockFromSettings(user)
    await until(() => expectUnlockScreen())
    expect(screen.queryByText(NOTE_TITLE)).not.toBeInTheDocument()
  })

  it('rewraps after verifying the current passphrase and keeps content unchanged', async () => {
    await seedLibrary()
    const user = typing()
    renderApp()
    await unlockAndWaitForLibrary(user)

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: 'Change passphrase' }))
    const dialog = screen.getByRole('dialog', { name: 'Change passphrase' })
    await user.type(within(dialog).getByLabelText('Current passphrase'), 'not the current phrase')
    await user.type(within(dialog).getByLabelText('New passphrase'), NEW_PASSPHRASE)
    await user.type(within(dialog).getByLabelText('Confirm new passphrase'), NEW_PASSPHRASE)
    await user.click(within(dialog).getByRole('button', { name: 'Update passphrase' }))
    await until(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('current passphrase'))

    await user.clear(within(dialog).getByLabelText('Current passphrase'))
    await user.type(within(dialog).getByLabelText('Current passphrase'), PASSPHRASE)
    await user.click(within(dialog).getByRole('button', { name: 'Update passphrase' }))
    await until(() => expect(within(dialog).getByRole('status')).toHaveTextContent('Passphrase changed.'))
    await until(() => expect(screen.getByText(NOTE_TITLE)).toBeInTheDocument())

    await user.click(within(dialog).getByRole('button', { name: 'Close dialog' }))
    await openLockFromSettings(user)
    await until(() => expectUnlockScreen())

    await unlockThroughUi(user, PASSPHRASE)
    await until(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not unlock this vault.'))
    await user.clear(screen.getByLabelText('Passphrase'))
    await unlockThroughUi(user, NEW_PASSPHRASE)
    await until(() => expect(screen.getByText(NOTE_TITLE)).toBeInTheDocument())
  }, 60000)
})

describe('changes from another tab', () => {
  async function replaceHeaderElsewhere(): Promise<void> {
    const init = await readHeader()
    if (!init.ok || init.library !== 'present') throw new Error('expected a library')
    const session = { header: init.header.header, generation: init.header.meta.generation, dataKey: vault.dataKey }
    const header = await actualRewrap(session, PASSPHRASE, NEW_PASSPHRASE)
    const result = await changePassphrase(
      session,
      { generation: session.generation, expectedRevision: init.header.meta.revision },
      header,
    )
    if (!result.ok) throw new Error(result.message)
    const channel = new BroadcastChannel('scratch-v1-changes')
    channel.postMessage({ vaultId: header.vaultId, generation: session.generation, revision: result.snapshot.meta.revision })
    channel.close()
  }

  it(
    'releases the session and asks to unlock again when there is no dirty draft',
    async () => {
      await seedLibrary()
      const user = typing()
      renderApp()
      await unlockAndWaitForLibrary(user)
      await replaceHeaderElsewhere()
      await until(() => expectUnlockScreen())
      expect(screen.queryByText(NOTE_TITLE)).not.toBeInTheDocument()
    },
    60000,
  )

  it(
    'keeps the session and the draft when only the passphrase header changed elsewhere',
    async () => {
      await seedLibrary()
      const user = typing()
      renderApp(true)
      await unlockAndWaitForLibrary(user)
      await typeDraft(user)
      await replaceHeaderElsewhere()
      await act(async () => {
        await new Promise<void>((resolve) => realSetTimeout(resolve, 300))
      })
      expect(screen.queryByRole('heading', { name: 'This library changed in another tab' })).not.toBeInTheDocument()
      expect(screen.getByLabelText('Draft')).toBeVisible()
      expect(screen.getByLabelText('Draft')).toHaveValue(DRAFT_TEXT)
      expect(spies.discard).not.toHaveBeenCalled()
      // The normal lock path still applies: the draft is sealed and comes back.
      advance(10 * MINUTE + 1000)
      await until(() => expectUnlockScreen())
      await unlockThroughUi(user, NEW_PASSPHRASE)
      await until(() => expect(screen.getByLabelText('Draft')).toHaveValue(DRAFT_TEXT))
    },
    60000,
  )

  it(
    'conceals the library and offers recovery when a dirty draft exists',
    async () => {
      await seedLibrary()
      const user = typing()
      renderApp(true)
      await unlockAndWaitForLibrary(user)
      await typeDraft(user)
      await replaceLibraryElsewhere()

      await until(() =>
        expect(screen.getByRole('heading', { name: 'This library changed in another tab' })).toBeInTheDocument(),
      )
      expect(screen.queryByText(NOTE_TITLE)).not.toBeVisible()
      expect(screen.queryByRole('heading', { name: 'Unlock Scratch' })).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Export backup' }))
      await until(() => expect(screen.getByText('Backup exported.')).toBeInTheDocument())
      expect(spies.exportRecovery).toHaveBeenCalledTimes(1)
      const call = spies.exportRecovery.mock.calls[0][0]
      expect(call.draft.input.body).toBe(DRAFT_TEXT)
      expect(call.snapshot.items.map((item: { title: string }) => item.title)).toContain(NOTE_TITLE)
      expect(spies.discard).not.toHaveBeenCalled()

      await user.click(screen.getByRole('button', { name: 'Discard draft and reload' }))
      await until(() => expectUnlockScreen())
      expect(spies.discard).toHaveBeenCalledTimes(1)
    },
    60000,
  )
})

describe('session hardening', () => {
  async function openRemoteRecovery(user: ReturnType<typeof typing>) {
    await seedLibrary()
    renderApp(true)
    await unlockAndWaitForLibrary(user)
    await typeDraft(user)
    await replaceLibraryElsewhere()
    await until(() =>
      expect(screen.getByRole('heading', { name: 'This library changed in another tab' })).toBeInTheDocument(),
    )
  }

  it('does not let an automatic lock discard the draft while recovery is showing', async () => {
    const user = typing()
    await openRemoteRecovery(user)

    transitionVisibility(true)
    jumpClock(61_000)
    transitionVisibility(false)
    advance(11 * MINUTE)
    await act(async () => {
      await new Promise<void>((resolve) => realSetTimeout(resolve, 50))
    })
    expect(screen.getByRole('heading', { name: 'This library changed in another tab' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Unlock Scratch' })).not.toBeInTheDocument()
    expect(spies.discard).not.toHaveBeenCalled()

    // The deadline passed while the panel was up: nothing is reachable until the
    // passphrase for this library is entered again.
    expect(screen.getByRole('button', { name: 'Export backup' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Keep editing' })).toBeDisabled()
    await user.type(screen.getByLabelText('Passphrase'), 'not the passphrase at all')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await until(() => expect(screen.getByRole('alert')).toHaveTextContent('incorrect'))
    expect(screen.getByRole('button', { name: 'Export backup' })).toBeDisabled()
    expect(spies.exportRecovery).not.toHaveBeenCalled()
    await user.clear(screen.getByLabelText('Passphrase'))
    await user.type(screen.getByLabelText('Passphrase'), PASSPHRASE)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await until(() => expect(screen.getByRole('button', { name: 'Export backup' })).toBeEnabled())

    await user.click(screen.getByRole('button', { name: 'Export backup' }))
    await until(() => expect(screen.getByText('Backup exported.')).toBeInTheDocument())
    expect(spies.exportRecovery.mock.calls[0][0].draft.input.body).toBe(DRAFT_TEXT)
    await user.click(screen.getByRole('button', { name: 'Discard draft and reload' }))
    await until(() => expectUnlockScreen())
    expect(spies.discard).toHaveBeenCalledTimes(1)
  })

  it('lets the draft be discarded without a passphrase after the deadline', async () => {
    const user = typing()
    await openRemoteRecovery(user)
    advance(11 * MINUTE)
    await until(() => expect(screen.getByRole('button', { name: 'Keep editing' })).toBeDisabled())
    await user.click(screen.getByRole('button', { name: 'Discard draft and reload' }))
    await until(() => expectUnlockScreen())
    expect(spies.discard).toHaveBeenCalledTimes(1)
  })

  it('requires the passphrase again when the deadline passes after Keep editing', async () => {
    const user = typing()
    await openRemoteRecovery(user)
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByLabelText('Draft')).toBeVisible()
    expect(screen.getByLabelText('Draft')).toHaveValue(DRAFT_TEXT)
    advance(11 * MINUTE)
    await until(() => expect(screen.getByRole('heading', { name: 'This library changed in another tab' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Keep editing' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Export backup' })).toBeDisabled()
    await user.type(screen.getByLabelText('Passphrase'), PASSPHRASE)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await until(() => expect(screen.getByRole('button', { name: 'Keep editing' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByLabelText('Draft')).toHaveValue(DRAFT_TEXT)
  })

  it('treats a failing draft read during automatic lock like a seal failure', async () => {
    await seedLibrary()
    const user = typing()
    renderApp(true)
    await unlockAndWaitForLibrary(user)
    await typeDraft(user)
    readFails = true
    advance(10 * MINUTE + 1000)
    await until(() => expect(screen.getByRole('heading', { name: 'Could not lock Scratch' })).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: 'Unlock Scratch' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Discard draft and lock' }))
    await until(() => expectUnlockScreen())
  })

  it('returns to locked with safe copy when unlocking throws', async () => {
    await seedLibrary()
    vi.mocked(crypto_.unlockVault).mockRejectedValueOnce(new Error('corrupt header'))
    const user = typing()
    renderApp()
    await unlockThroughUi(user)
    await until(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not unlock this vault. Try again.'))
    expectUnlockScreen()
    expect(screen.queryByRole('status', { name: 'Unlocking' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeEnabled()
  })

  it('disables Save draft and lock while saving so it runs once', async () => {
    await seedLibrary()
    vi.mocked(crypto_.sealEnvelope).mockRejectedValueOnce(new Error('encrypt failed'))
    let finish!: (result: MutationResult) => void
    spies.save.mockImplementation(() => new Promise<MutationResult>((resolve) => { finish = resolve }))
    const user = typing()
    renderApp(true)
    await unlockAndWaitForLibrary(user)
    await typeDraft(user)
    advance(10 * MINUTE + 1000)
    await until(() => expect(screen.getByRole('heading', { name: 'Could not lock Scratch' })).toBeInTheDocument())
    const button = screen.getByRole('button', { name: 'Save draft and lock' })
    await user.click(button)
    await user.click(button)
    expect(button).toBeDisabled()
    expect(spies.save).toHaveBeenCalledTimes(1)
    finish({ ok: false, code: 'quota', message: 'Not enough local storage space.' })
    await until(() => expect(screen.getByRole('button', { name: 'Save draft and lock' })).toBeEnabled())
  })

  it('clears both setup fields after a failed create', async () => {
    const user = typing()
    render(<App />)
    await until(() => screen.getByLabelText('Passphrase'))
    await user.type(screen.getByLabelText('Passphrase'), 'short')
    await user.type(screen.getByLabelText('Confirm passphrase'), 'short')
    await user.click(screen.getByRole('button', { name: 'Create vault' }))
    await until(() => expect(screen.getByRole('alert')).toHaveTextContent('at least 12'))
    expect(screen.getByLabelText('Passphrase')).toHaveValue('')
    expect(screen.getByLabelText('Confirm passphrase')).toHaveValue('')
  })

  it('uses the wrong-passphrase copy only for a genuine wrong passphrase', async () => {
    await seedLibrary()
    vi.mocked(crypto_.rewrapVault).mockRejectedValueOnce(new Error('unexpected failure'))
    const user = typing()
    renderApp()
    await unlockAndWaitForLibrary(user)
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: 'Change passphrase' }))
    const dialog = screen.getByRole('dialog', { name: 'Change passphrase' })
    await user.type(within(dialog).getByLabelText('Current passphrase'), PASSPHRASE)
    await user.type(within(dialog).getByLabelText('New passphrase'), NEW_PASSPHRASE)
    await user.type(within(dialog).getByLabelText('Confirm new passphrase'), NEW_PASSPHRASE)
    await user.click(within(dialog).getByRole('button', { name: 'Update passphrase' }))
    await until(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Could not change the passphrase. Try again.'))
    expect(within(dialog).getByRole('alert')).not.toHaveTextContent('incorrect')
  })
})
