import { useEffect } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
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
  const environment: OfflineEnvironment = { onControllerChange: (callback) => { if (takesControl) queueMicrotask(callback); return () => {} }, reload, activationTimeoutMs: 100 }
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

async function setup(draft: DirtyDraft | null, store: OfflineStore) {
  render(<VaultProvider><Draft draft={draft} /><UpdateNotice store={store} /></VaultProvider>)
  // The provider renders its children once it has checked storage.
  await waitFor(() => expect(screen.queryByText('Opening Scratch')).toBeNull())
}

afterEach(() => { try { sessionStorage.clear() } catch { /* unavailable */ } })

describe('UpdateNotice', () => {
  it('shows nothing until an update is ready and announces the first install', async () => {
    const { store, callbacks } = makeStore()
    await setup(null, store)
    expect(screen.queryByText('A new version of Scratch is ready.')).toBeNull()
    act(() => callbacks().onOfflineReady())
    expect(screen.getByText('Scratch is ready to work offline.')).toBeInTheDocument()
  })

  it('activates straight away when no draft is dirty', async () => {
    const { store, update, reload, callbacks } = makeStore()
    await setup(null, store)
    act(() => callbacks().onNeedRefresh())
    await userEvent.click(screen.getByRole('button', { name: 'Update now' }))
    expect(update).toHaveBeenCalledWith(false)
    await waitFor(() => expect(reload).toHaveBeenCalled())
  })

  it('Later hides the prompt without activating', async () => {
    const { store, update, callbacks } = makeStore()
    await setup(null, store)
    act(() => callbacks().onNeedRefresh())
    await userEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(screen.queryByText('A new version of Scratch is ready.')).toBeNull()
    expect(update).not.toHaveBeenCalled()
  })

  it('Cancel with a dirty draft keeps the worker waiting and resumes the editor', async () => {
    const { store, update, reload, callbacks } = makeStore()
    const draft = makeDraft(async () => ({ ok: true }))
    await setup(draft, store)
    act(() => callbacks().onNeedRefresh())
    await userEvent.click(screen.getByRole('button', { name: 'Update now' }))
    expect(update).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(draft.cancel).toHaveBeenCalled()
    expect(draft.save).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(store.getState().updateReady).toBe(true)
  })

  it('Save and update saves first, then activates', async () => {
    const { store, update, reload, callbacks } = makeStore()
    const draft = makeDraft(async () => ({ ok: true }))
    await setup(draft, store)
    act(() => callbacks().onNeedRefresh())
    await userEvent.click(screen.getByRole('button', { name: 'Update now' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save and update' }))
    expect(draft.save).toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(false)
    await waitFor(() => expect(reload).toHaveBeenCalled())
  })

  it('a failed save cancels activation and says so', async () => {
    const { store, update, reload, callbacks } = makeStore()
    const draft = makeDraft(async () => ({ ok: false, message: 'Storage is full.' }))
    await setup(draft, store)
    act(() => callbacks().onNeedRefresh())
    await userEvent.click(screen.getByRole('button', { name: 'Update now' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save and update' }))
    expect(update).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(draft.discard).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Not updated. Your note was not saved: Storage is full.')
    expect(store.getState().updateReady).toBe(true)
  })

  it('Discard and update discards the draft, then activates', async () => {
    const { store, update, reload, callbacks } = makeStore()
    const draft = makeDraft(async () => ({ ok: true }))
    await setup(draft, store)
    act(() => callbacks().onNeedRefresh())
    await userEvent.click(screen.getByRole('button', { name: 'Update now' }))
    await userEvent.click(screen.getByRole('button', { name: 'Discard and update' }))
    expect(draft.discard).toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(false)
    await waitFor(() => expect(reload).toHaveBeenCalled())
  })

  it('shows a passing notice, without blocking the app, when offline use is unavailable', async () => {
    const store = createOfflineStore()
    store.start(() => async () => undefined, false)
    await setup(null, store)
    expect(screen.getByText(/Offline use is not available here/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
    await waitFor(() => expect(screen.queryByText(/Offline use is not available here/)).toBeNull(), { timeout: 8000 })
  }, 12000)

  it('a failed save puts the editor back in charge of focus', async () => {
    const { store, callbacks } = makeStore()
    const draft = makeDraft(async () => ({ ok: false, message: 'Storage is full.' }))
    await setup(draft, store)
    act(() => callbacks().onNeedRefresh())
    await userEvent.click(screen.getByRole('button', { name: 'Update now' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save and update' }))
    await waitFor(() => expect(draft.cancel).toHaveBeenCalled())
  })

  it('says the note was discarded when activation fails after Discard, and focuses the notice', async () => {
    const { store, reload, callbacks } = makeStore(async () => { throw new Error('no worker') }, false)
    const draft = makeDraft(async () => ({ ok: true }))
    await setup(draft, store)
    act(() => callbacks().onNeedRefresh())
    await userEvent.click(screen.getByRole('button', { name: 'Update now' }))
    await userEvent.click(screen.getByRole('button', { name: 'Discard and update' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Your unsaved note was discarded')
    expect(reload).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveFocus())
  })

  it('does not show the unavailable notice again in the same browser session', async () => {
    const first = createOfflineStore()
    first.start(() => async () => undefined, false)
    await setup(null, first)
    expect(screen.getByText(/Offline use is not available here/)).toBeInTheDocument()
    cleanup()
    const second = createOfflineStore()
    second.start(() => async () => undefined, false)
    await setup(null, second)
    expect(screen.queryByText(/Offline use is not available here/)).toBeNull()
  })

  it('clears status messages by themselves but keeps the update prompt', async () => {
    const { store, callbacks } = makeStore()
    await setup(null, store)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      act(() => callbacks().onOfflineReady())
      expect(screen.getByText('Scratch is ready to work offline.')).toBeInTheDocument()
      act(() => { vi.advanceTimersByTime(8000) })
      expect(screen.queryByText('Scratch is ready to work offline.')).toBeNull()
      act(() => callbacks().onNeedRefresh())
      act(() => { vi.advanceTimersByTime(60000) })
      expect(screen.getByText('A new version of Scratch is ready.')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('is reachable by keyboard inside an open editor dialog, and Cancel returns to the editor', async () => {
    const { store, update, callbacks } = makeStore()
    const draft = makeDraft(async () => ({ ok: true }))
    render(<VaultProvider><Draft draft={draft} /><Dialog title="New note" onRequestClose={() => {}} canClose={() => true}><textarea aria-label="Note body" /></Dialog><UpdateNotice store={store} /></VaultProvider>)
    await waitFor(() => expect(screen.queryByText('Opening Scratch')).toBeNull())
    act(() => callbacks().onNeedRefresh())
    const dialog = screen.getByRole('dialog', { name: 'New note' })
    const button = screen.getByRole('button', { name: 'Update now' })
    expect(dialog).toContainElement(button)
    const user = userEvent.setup()
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
