import { useEffect } from 'react'
import { act, cleanup, configure, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from '../src/components/Dialog'
import { createOfflineStore, type OfflineEnvironment, type OfflineStore, type RegisterCallbacks } from '../src/features/offline/register'
import { UpdateNotice } from '../src/features/offline/UpdateNotice'
import type { DirtyDraft } from '../src/features/vault/session'
import { useVault, VaultProvider } from '../src/features/vault/VaultProvider'

// The update prompt must never activate a new worker (which reloads the page)
// while an unsaved note could be lost.

function makeStore(activate: () => Promise<void> = async () => undefined, takesControl = true) {
  let callbacks!: RegisterCallbacks
  const update = vi.fn(activate)
  const reload = vi.fn()
  // The new worker takes control as soon as it is told to activate.
  const environment: OfflineEnvironment = { onControllerChange: (callback) => { if (takesControl) queueMicrotask(callback); return () => {} }, reload, activationTimeoutMs: 5000 }
  const store = createOfflineStore(environment)
  store.start((given) => { callbacks = given; return update }, true)
  return { store, update, reload, callbacks: () => callbacks }
}

function Draft({ draft }: { draft: DirtyDraft | null }) {
  const { registerDraft } = useVault()
  useEffect(() => (draft ? registerDraft(draft) : undefined), [draft, registerDraft])
  return null
}

function makeDraft(save: () => Promise<unknown>) {
  return {
    read: () => ({ noteId: null, input: { parentId: null, title: '', body: 'x', isSecret: false } }),
    save: vi.fn(save),
    discard: vi.fn(),
    cancel: vi.fn(),
  } as unknown as DirtyDraft
}

// The notice mounts once the vault provider has checked storage. Waiting on the
// notice itself, not on the loading text, means nothing is raced under load.
async function ready() {
  await waitFor(() => expect(document.querySelector('[data-update-live]')).not.toBeNull(), { timeout: 3000 })
}

async function setup(draft: DirtyDraft | null, store: OfflineStore) {
  render(<VaultProvider><Draft draft={draft} /><UpdateNotice store={store} /></VaultProvider>)
  // The provider renders its children once it has checked storage.
  await ready()
}

// Generous budget so a contended parallel suite does not turn slow into flaky.
configure({ asyncUtilTimeout: 3000 })

const shown = (text: string | RegExp) => screen.queryAllByText(text).length > 0

afterEach(() => { try { sessionStorage.clear() } catch { /* unavailable */ } })

describe('UpdateNotice', () => {
  it('shows nothing until an update is ready and announces the first install', async () => {
    const { store, callbacks } = makeStore()
    await setup(null, store)
    expect(shown('A new version of Scratch is ready.')).toBe(false)
    act(() => callbacks().onOfflineReady())
    await waitFor(() => expect(shown('Scratch is ready to work offline.')).toBe(true))
  })

  it('activates straight away when no draft is dirty', async () => {
    const user = userEvent.setup()
    const { store, update, reload, callbacks } = makeStore()
    await setup(null, store)
    act(() => callbacks().onNeedRefresh())
    await user.click(await screen.findByRole('button', { name: 'Update now' }))
    expect(update).toHaveBeenCalledWith(false)
    await waitFor(() => expect(reload).toHaveBeenCalled(), { timeout: 3000 })
  })

  it('an update approved in another tab leaves a dirty draft running and offers the update', async () => {
    const user = userEvent.setup()
    const { store, update, reload, callbacks } = makeStore()
    const draft = makeDraft(async () => ({ ok: true }))
    await setup(draft, store)
    act(() => callbacks().onNeedRefresh())
    act(() => callbacks().onNeedReload())
    expect(reload).not.toHaveBeenCalled()
    expect(draft.discard).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'Update now' }))
    expect(await screen.findByRole('button', { name: 'Save and update' })).toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('Later hides the prompt without activating', async () => {
    const user = userEvent.setup()
    const { store, update, callbacks } = makeStore()
    await setup(null, store)
    act(() => callbacks().onNeedRefresh())
    await user.click(await screen.findByRole('button', { name: 'Later' }))
    expect(shown('A new version of Scratch is ready.')).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('Cancel with a dirty draft keeps the worker waiting and resumes the editor', async () => {
    const user = userEvent.setup()
    const { store, update, reload, callbacks } = makeStore()
    const draft = makeDraft(async () => ({ ok: true }))
    await setup(draft, store)
    act(() => callbacks().onNeedRefresh())
    await user.click(await screen.findByRole('button', { name: 'Update now' }))
    expect(update).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(draft.cancel).toHaveBeenCalled()
    expect(draft.save).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(store.getState().updateReady).toBe(true)
  })

  it('Save and update saves first, then activates', async () => {
    const user = userEvent.setup()
    const { store, update, reload, callbacks } = makeStore()
    const draft = makeDraft(async () => ({ ok: true }))
    await setup(draft, store)
    act(() => callbacks().onNeedRefresh())
    await user.click(await screen.findByRole('button', { name: 'Update now' }))
    await user.click(await screen.findByRole('button', { name: 'Save and update' }))
    expect(draft.save).toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(false)
    await waitFor(() => expect(reload).toHaveBeenCalled(), { timeout: 3000 })
  })

  it('a failed save cancels activation and says so', async () => {
    const user = userEvent.setup()
    const { store, update, reload, callbacks } = makeStore()
    const draft = makeDraft(async () => ({ ok: false, message: 'Storage is full.' }))
    await setup(draft, store)
    act(() => callbacks().onNeedRefresh())
    await user.click(await screen.findByRole('button', { name: 'Update now' }))
    await user.click(await screen.findByRole('button', { name: 'Save and update' }))
    expect(update).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(draft.discard).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent('Not updated. Your note was not saved: Storage is full.')
    expect(store.getState().updateReady).toBe(true)
  })

  it('Discard and update discards the draft, then activates', async () => {
    const user = userEvent.setup()
    const { store, update, reload, callbacks } = makeStore()
    const draft = makeDraft(async () => ({ ok: true }))
    await setup(draft, store)
    act(() => callbacks().onNeedRefresh())
    await user.click(await screen.findByRole('button', { name: 'Update now' }))
    await user.click(await screen.findByRole('button', { name: 'Discard and update' }))
    expect(draft.discard).toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(false)
    await waitFor(() => expect(reload).toHaveBeenCalled(), { timeout: 3000 })
  })

  it('shows a passing notice, without blocking the app, when offline use is unavailable', async () => {
    const store = createOfflineStore()
    await setup(null, store)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      act(() => store.start(() => async () => undefined, false))
      expect(shown(/Offline use is not available here/)).toBe(true)
      expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
      act(() => { vi.advanceTimersByTime(7000) })
      expect(shown(/Offline use is not available here/)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a failed save puts the editor back in charge of focus', async () => {
    const user = userEvent.setup()
    const { store, callbacks } = makeStore()
    const draft = makeDraft(async () => ({ ok: false, message: 'Storage is full.' }))
    ;(draft.cancel as ReturnType<typeof vi.fn>).mockImplementation(() => screen.getByRole('textbox', { name: 'Note body' }).focus())
    render(<VaultProvider><Draft draft={draft} /><Dialog title="New note" onRequestClose={() => {}} canClose={() => true}><textarea aria-label="Note body" /></Dialog><UpdateNotice store={store} /></VaultProvider>)
    await ready()
    act(() => callbacks().onNeedRefresh())
    await user.click(await screen.findByRole('button', { name: 'Update now' }))
    await user.click(await screen.findByRole('button', { name: 'Save and update' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Note body' })).toHaveFocus(), { timeout: 3000 })
  })

  it('has a polite live region mounted before any message, on the page and inside an open dialog', async () => {
    const { store, callbacks } = makeStore()
    render(<VaultProvider><UpdateNotice store={store} /></VaultProvider>)
    await ready()
    const page = document.querySelector('[data-update-live]')
    expect(page).not.toBeNull()
    expect(page).toHaveAttribute('aria-live', 'polite')
    // Atomic, so a status that changes in place is read whole, not as a fragment.
    expect(page).toHaveAttribute('aria-atomic', 'true')
    expect(page).toBeEmptyDOMElement()
    act(() => callbacks().onNeedRefresh())
    await waitFor(() => expect(page).toHaveTextContent('A new version of Scratch is ready.'))
    expect(document.querySelector('[data-update-live]')).toBe(page)
    cleanup()
    const next = makeStore()
    render(<VaultProvider><Dialog title="New note" onRequestClose={() => {}} canClose={() => true}><textarea aria-label="Note body" /></Dialog><UpdateNotice store={next.store} /></VaultProvider>)
    await ready()
    // The dialog's region mounts one render after the dialog itself.
    const dialogRegion = () => screen.getByRole('dialog', { name: 'New note' }).querySelector('[data-update-live]')
    await waitFor(() => expect(dialogRegion()).not.toBeNull())
    const inside = dialogRegion()
    expect(inside).toHaveAttribute('aria-live', 'polite')
    expect(inside).toHaveAttribute('aria-atomic', 'true')
    expect(inside).toBeEmptyDOMElement()
    act(() => next.callbacks().onNeedRefresh())
    await waitFor(() => expect(inside).toHaveTextContent('A new version of Scratch is ready.'))
  })

  it('moves focus into the dialog when the focused banner control goes away', async () => {
    const user = userEvent.setup()
    const { store, callbacks } = makeStore()
    render(<VaultProvider><Dialog title="New note" onRequestClose={() => {}} canClose={() => true}><textarea aria-label="Note body" data-autofocus="" /></Dialog><UpdateNotice store={store} /></VaultProvider>)
    await ready()
    act(() => callbacks().onNeedRefresh())
    await user.click(await screen.findByRole('button', { name: 'Later' }))
    const dialog = screen.getByRole('dialog', { name: 'New note' })
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))
    expect(document.activeElement).not.toBe(document.body)
  })

  it('says the note was discarded when activation fails after Discard, and focuses the notice', async () => {
    const user = userEvent.setup()
    const { store, reload, callbacks } = makeStore(async () => { throw new Error('no worker') }, false)
    const draft = makeDraft(async () => ({ ok: true }))
    await setup(draft, store)
    act(() => callbacks().onNeedRefresh())
    await user.click(await screen.findByRole('button', { name: 'Update now' }))
    await user.click(await screen.findByRole('button', { name: 'Discard and update' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Your unsaved note was discarded')
    expect(reload).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveFocus())
  })

  it('does not show the unavailable notice again in the same browser session', async () => {
    const first = createOfflineStore()
    first.start(() => async () => undefined, false)
    await setup(null, first)
    expect(shown(/Offline use is not available here/)).toBe(true)
    cleanup()
    const second = createOfflineStore()
    second.start(() => async () => undefined, false)
    await setup(null, second)
    expect(shown(/Offline use is not available here/)).toBe(false)
  })

  it('clears status messages by themselves but keeps the update prompt', async () => {
    const { store, callbacks } = makeStore()
    await setup(null, store)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      act(() => callbacks().onOfflineReady())
      expect(shown('Scratch is ready to work offline.')).toBe(true)
      act(() => { vi.advanceTimersByTime(8000) })
      expect(shown('Scratch is ready to work offline.')).toBe(false)
      act(() => callbacks().onNeedRefresh())
      act(() => { vi.advanceTimersByTime(60000) })
      expect(shown('A new version of Scratch is ready.')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('is reachable by keyboard inside an open editor dialog, and Cancel returns to the editor', async () => {
    const user = userEvent.setup()
    const { store, update, callbacks } = makeStore()
    const draft = makeDraft(async () => ({ ok: true }))
    render(<VaultProvider><Draft draft={draft} /><Dialog title="New note" onRequestClose={() => {}} canClose={() => true}><textarea aria-label="Note body" /></Dialog><UpdateNotice store={store} /></VaultProvider>)
    await ready()
    act(() => callbacks().onNeedRefresh())
    const dialog = screen.getByRole('dialog', { name: 'New note' })
    const button = await screen.findByRole('button', { name: 'Update now' })
    expect(dialog).toContainElement(button)
    for (let i = 0; i < 6 && document.activeElement !== button; i++) await user.tab()
    expect(button).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: 'Update Scratch?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(draft.cancel).toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Note body' })).toBeInTheDocument()
  })
})
