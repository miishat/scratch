import { useState } from 'react'
import { Dialog } from '../../components/Dialog'
import { useVault } from '../vault/VaultProvider'
import { offlineStore, type OfflineStore } from './register'
import { useOffline } from './useOffline'

// Offline status and the update prompt. An update replaces the running app, so
// activation is gated behind the same Save, Discard, or Cancel choice that
// protects an unsaved note when locking. A failed save never activates.
export function UpdateNotice({ store = offlineStore }: { store?: OfflineStore }) {
  const offline = useOffline(store)
  const vault = useVault()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [quietUnavailable, setQuietUnavailable] = useState(false)

  async function activate() {
    try {
      await store.activateUpdate()
    } catch {
      setAsking(false)
      setBusy(false)
      setFailure('Not updated. Scratch could not start the update. Try again later.')
    }
  }

  function updateNow() {
    setFailure(null)
    if (!vault.hasDirtyDraft) {
      void activate()
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
      setFailure(`Not updated. Your note was not saved: ${message}`)
      return
    }
    await activate()
  }

  function discardAndUpdate() {
    setBusy(true)
    vault.discardDraft()
    void activate()
  }

  function cancel() {
    setAsking(false)
    vault.cancelDraft()
  }

  const unavailable = (offline.support === 'unsupported' || offline.support === 'failed') && !quietUnavailable
  const quiet = !offline.updateReady && !failure && !asking

  return <>
    {offline.updateReady && !asking && <div className="update-notice" data-focus-exempt="" role="status">
      <p>A new version of Scratch is ready.</p>
      <div className="dialog-actions">
        <button className="primary-button" type="button" onClick={updateNow}>Update now</button>
        <button type="button" onClick={store.dismissUpdate}>Later</button>
      </div>
    </div>}
    {failure && <div className="update-notice" data-focus-exempt="" role="alert">
      <p>{failure}</p>
      <div className="dialog-actions"><button type="button" onClick={() => setFailure(null)}>Dismiss</button></div>
    </div>}
    {quiet && offline.offlineReady && <div className="update-notice" data-focus-exempt="" role="status">
      <p>Scratch is ready to work offline.</p>
      <div className="dialog-actions"><button type="button" onClick={store.dismissOfflineReady}>Dismiss</button></div>
    </div>}
    {quiet && !offline.offlineReady && unavailable && <div className="update-notice" data-focus-exempt="" role="status">
      <p>Offline use is not available here. Your notes are still saved on this device.</p>
      <div className="dialog-actions"><button type="button" onClick={() => setQuietUnavailable(true)}>Dismiss</button></div>
    </div>}
    {asking && <Dialog title="Update Scratch?" onRequestClose={cancel} canClose={() => !busy}>
      <p>You have an unsaved note. Choose what happens to it before Scratch updates and reloads.</p>
      <div className="dialog-actions">
        <button className="primary-button" type="button" disabled={busy} onClick={() => void saveAndUpdate()}>Save and update</button>
        <button type="button" disabled={busy} onClick={discardAndUpdate}>Discard and update</button>
        <button type="button" disabled={busy} onClick={cancel}>Cancel</button>
      </div>
    </Dialog>}
  </>
}
