import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Dialog, useTopDialogSlot } from '../../components/Dialog'
import { useVault } from '../vault/VaultProvider'
import { offlineStore, type OfflineStore } from './register'
import { useOffline } from './useOffline'

const STATUS_MS = 6000
const UNAVAILABLE_KEY = 'scratch-offline-unavailable-shown'

function unavailableAlreadyShown(): boolean {
  try {
    return sessionStorage.getItem(UNAVAILABLE_KEY) === '1'
  } catch {
    return false
  }
}

function rememberUnavailableShown(): void {
  try {
    sessionStorage.setItem(UNAVAILABLE_KEY, '1')
  } catch { /* Private mode or blocked storage: the notice may repeat. */ }
}

// Clears a pure status message after a few seconds or on the first key press, so
// it never lingers over the person's first note. A tap is deliberately not a
// trigger: removing the message could shift the page under the finger.
function useAutoDismiss(active: boolean, dismiss: () => void) {
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(dismiss, STATUS_MS)
    document.addEventListener('keydown', dismiss, { once: true })
    return () => {
      clearTimeout(timer)
      document.removeEventListener('keydown', dismiss)
    }
  }, [active, dismiss])
}

interface Failure {
  message: string
  // Where focus goes once the confirmation dialog is gone.
  focus: 'editor' | 'notice'
}

// Offline status and the update prompt. An update replaces the running app, so
// activation is gated behind the same Save, Discard, or Cancel choice that
// protects an unsaved note when locking. A failed save never activates.
// The notice renders at the top of the page, or inside the topmost open dialog
// (such as the note editor) so it is reachable there without leaving the dialog.
export function UpdateNotice({ store = offlineStore }: { store?: OfflineStore }) {
  const offline = useOffline(store)
  const vault = useVault()
  const slot = useTopDialogSlot()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [unavailableDismissed, setUnavailableDismissed] = useState(unavailableAlreadyShown)
  const dismissFailure = useRef<HTMLButtonElement>(null)
  const { cancelDraft } = vault

  async function activate(discarded: boolean) {
    try {
      await store.activateUpdate()
    } catch {
      setAsking(false)
      setBusy(false)
      setFailure({
        message: discarded
          ? 'Not updated. Your unsaved note was discarded and Scratch could not start the update. Try again later.'
          : 'Not updated. Scratch could not start the update. Try again later.',
        focus: 'notice',
      })
    }
  }

  function updateNow() {
    setFailure(null)
    if (!vault.hasDirtyDraft) {
      void activate(false)
      return
    }
    setAsking(true)
  }

  async function saveAndUpdate() {
    setBusy(true)
    const message = await vault.saveDraft()
    if (message !== null) {
      setBusy(false)
      setAsking(false)
      setFailure({ message: `Not updated. Your note was not saved: ${message}`, focus: 'editor' })
      return
    }
    await activate(false)
  }

  function discardAndUpdate() {
    setBusy(true)
    vault.discardDraft()
    void activate(true)
  }

  // The editor takes focus back only once this dialog has gone, or the dialog's
  // own focus containment would pull it away again.
  const resumePending = useRef(false)
  function cancel() {
    resumePending.current = true
    setAsking(false)
  }
  useEffect(() => {
    if (asking || !resumePending.current) return
    resumePending.current = false
    cancelDraft()
  }, [asking, cancelDraft])

  // The dialog that asked has unmounted by now, so focus is placed explicitly.
  // The notice can move between the page and a dialog slot as dialogs close, which
  // replaces its buttons, so the request is kept until the focus has landed.
  const focusPending = useRef(false)
  useEffect(() => {
    if (!failure) return
    if (failure.focus === 'editor') cancelDraft()
    else focusPending.current = true
  }, [failure, cancelDraft])
  useEffect(() => {
    const button = dismissFailure.current
    if (!focusPending.current || !button) return
    button.focus()
    if (document.activeElement === button) focusPending.current = false
  }, [failure, slot])

  // Dismissing a banner control removes the focused element; inside a dialog focus
  // goes to the dialog's own first control instead of falling to the page.
  const refocus = useRef(false)
  function leaveBanner() {
    if (slot) refocus.current = true
  }
  useEffect(() => {
    if (!refocus.current || !slot) return
    refocus.current = false
    const dialog = slot.closest<HTMLElement>('[role="dialog"]')
    const target = dialog?.querySelector<HTMLElement>('[data-autofocus]')
      ?? Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]') ?? []).find((element) => !slot.contains(element))
    ;(target ?? dialog)?.focus()
  }, [offline.updateReady, failure, slot])

  const unavailable = (offline.support === 'unsupported' || offline.support === 'failed') && !unavailableDismissed
  const quiet = !offline.updateReady && !failure && !asking
  const showReady = quiet && offline.offlineReady
  const showUnavailable = quiet && !offline.offlineReady && unavailable

  const dismissReady = store.dismissOfflineReady
  const dismissUnavailable = useCallback(() => setUnavailableDismissed(true), [])
  useAutoDismiss(showReady, dismissReady)
  useAutoDismiss(showUnavailable, dismissUnavailable)
  useEffect(() => {
    if (showUnavailable) rememberUnavailableShown()
  }, [showUnavailable])

  const banner = <>
    {offline.updateReady && !asking && <div className="update-notice">
      <p>A new version of Scratch is ready.</p>
      <div className="dialog-actions">
        <button className="primary-button" type="button" onClick={updateNow}>Update now</button>
        <button type="button" onClick={() => { leaveBanner(); store.dismissUpdate() }}>Later</button>
      </div>
    </div>}
    {failure && <div className="update-notice" role="alert">
      <p>{failure.message}</p>
      <div className="dialog-actions"><button ref={dismissFailure} type="button" onClick={() => { leaveBanner(); setFailure(null) }}>Dismiss</button></div>
    </div>}
  </>
  // Pure status text floats over the page without taking space or taps; inside a
  // dialog it sits in the dialog's slot instead.
  const status = showReady ? 'Scratch is ready to work offline.' : showUnavailable ? 'Offline use is not available here. Your notes are still saved on this device.' : null
  // The text is spoken by the live region below, so the visible copy is hidden from
  // assistive technology to avoid a second reading.
  const statusNode = status && <p className={slot ? 'update-status' : 'update-status update-status-floating'} aria-hidden="true">{status}</p>
  const announcement = status ?? (offline.updateReady && !asking ? 'A new version of Scratch is ready.' : '')
  // Live regions only speak changes to a region that already exists, so one stays
  // mounted: on the page, and inside the topmost dialog (which hides the page from
  // assistive technology). Only the one where the person is looking holds the text.
  const liveProps = { className: 'visually-hidden', 'aria-live': 'polite' as const, 'aria-atomic': true, 'data-update-live': '' }
  const hasBanner = (offline.updateReady && !asking) || failure !== null

  return <>
    <div {...liveProps}>{slot ? '' : announcement}</div>
    {slot && createPortal(<div {...liveProps}>{announcement}</div>, slot)}
    {statusNode && (slot ? createPortal(statusNode, slot) : statusNode)}
    {hasBanner && (slot ? createPortal(banner, slot) : <div className="update-flow">{banner}</div>)}
    {/* Mounted on the body so it stacks above an open editor dialog. */}
    {asking && createPortal(<Dialog title="Update Scratch?" onRequestClose={cancel} canClose={() => !busy}>
      <p>You have an unsaved note. Choose what happens to it before Scratch updates and reloads.</p>
      <div className="dialog-actions">
        <button className="primary-button" type="button" disabled={busy} onClick={() => void saveAndUpdate()}>Save and update</button>
        <button type="button" disabled={busy} onClick={discardAndUpdate}>Discard and update</button>
        <button type="button" disabled={busy} onClick={cancel}>Cancel</button>
      </div>
    </Dialog>, document.body)}
  </>
}
