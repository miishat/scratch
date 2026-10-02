import { useId, useState, type FormEvent } from 'react'
import { Logo } from '../../components/Logo'
import type { LibrarySnapshot } from '../library/types'
import { useVault } from './VaultProvider'
import type { DraftContent } from './session'
import type { VaultSession } from './types'

// Setup, unlock, and recovery screens. Fields are cleared after each attempt so a
// passphrase does not linger in the DOM. There are no accounts and no network.

export interface RecoveryExport {
  session: VaultSession
  snapshot: LibrarySnapshot | null
  draft: DraftContent
}

export type ExportRecoveryBackup = (info: RecoveryExport) => Promise<void>

// A refusal whose message is safe to show on the recovery panel, such as an
// invalid draft. Any other failure shows the generic message.
export class RecoveryExportError extends Error {}

export function VaultScreen({ onImportBackup }: { onImportBackup?: () => void }) {
  const { state } = useVault()
  if (state === 'setup') return <SetupScreen onImportBackup={onImportBackup} />
  return <UnlockScreen />
}

function SetupScreen({ onImportBackup }: { onImportBackup?: () => void }) {
  const { create } = useVault()
  const phraseId = useId()
  const confirmId = useId()
  const [phrase, setPhrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const attempt = phrase
    const matches = phrase === confirm
    setPhrase('')
    setConfirm('')
    if (!matches) {
      setError('Passphrases do not match.')
      return
    }
    setError(null)
    setBusy(true)
    const result = await create(attempt)
    if (!result.ok) {
      setError(result.message ?? 'Could not create the vault.')
      setBusy(false)
    }
  }

  return <main className="support-screen vault-screen vault-entry">
    <VaultBrand />
    <div className="vault-card">
      <h1>Set up Scratch</h1>
      <p>Choose a passphrase to protect your notes on this device. It cannot be recovered if you forget it.</p>
      <form className="vault-form" onSubmit={submit}>
        <label className="visually-hidden" htmlFor={phraseId}>Passphrase</label>
        <input id={phraseId} type="password" placeholder="Passphrase" autoComplete="new-password" autoFocus value={phrase} disabled={busy} onChange={(event) => setPhrase(event.target.value)} />
        <label className="visually-hidden" htmlFor={confirmId}>Confirm passphrase</label>
        <input id={confirmId} type="password" placeholder="Confirm passphrase" autoComplete="new-password" value={confirm} disabled={busy} onChange={(event) => setConfirm(event.target.value)} />
        {error && <p role="alert" className="form-error">{error}</p>}
        {busy && <p role="status" aria-label="Creating vault">Creating vault</p>}
        <div className="dialog-actions">
          <button className="primary-button" type="submit" disabled={busy}>Create vault</button>
          {onImportBackup && <button type="button" disabled={busy} onClick={onImportBackup}>Import backup</button>}
        </div>
      </form>
    </div>
  </main>
}

function VaultBrand() {
  return <div className="vault-brand" aria-hidden="true"><Logo className="vault-logo" /><span>Scratch</span></div>
}

function UnlockScreen() {
  const { state, unlock, error, notice } = useVault()
  const phraseId = useId()
  const [phrase, setPhrase] = useState('')
  const unlocking = state === 'unlocking'

  async function submit(event: FormEvent) {
    event.preventDefault()
    const attempt = phrase
    setPhrase('')
    await unlock(attempt)
  }

  return <main className="support-screen vault-screen vault-entry">
    <VaultBrand />
    <div className="vault-card">
      <h1 className="visually-hidden">Unlock Scratch</h1>
      {notice && <p role="status">{notice}</p>}
      <form className="vault-form" onSubmit={submit}>
        <label className="visually-hidden" htmlFor={phraseId}>Passphrase</label>
        <input id={phraseId} type="password" placeholder="Passphrase" autoComplete="current-password" autoFocus value={phrase} disabled={unlocking} onChange={(event) => setPhrase(event.target.value)} />
        {error && <p role="alert" className="form-error">{error}</p>}
        {unlocking && <p role="status" aria-label="Unlocking">Unlocking</p>}
        <div className="dialog-actions">
          <button className="primary-button" type="submit" disabled={unlocking}>Unlock</button>
        </div>
      </form>
    </div>
  </main>
}

// Shown when automatic lock could not seal a dirty draft. The editor stays
// concealed, and the user chooses explicitly what happens to the draft.
export function LockErrorPanel() {
  const { lockErrorMessage, saveAndLock, discardAndLock } = useVault()
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    await saveAndLock()
    setBusy(false)
  }
  return <main className="support-screen vault-screen">
    <h1>Could not lock Scratch</h1>
    <p role="alert">{lockErrorMessage}</p>
    <div className="dialog-actions">
      <button className="primary-button" type="button" disabled={busy} onClick={() => void save()}>Save draft and lock</button>
      <button type="button" disabled={busy} onClick={discardAndLock}>Discard draft and lock</button>
    </div>
  </main>
}

// Shown when another tab replaced the vault or its header while this tab holds a
// dirty draft. The draft is never dropped silently: export it or discard it. Once
// the inactivity or hidden deadline passes while it is up, export and Keep editing
// wait for the passphrase again; discarding never needs it.
export function RemoteChangePanel({
  snapshot,
  session,
  exportRecoveryBackup,
}: {
  snapshot: LibrarySnapshot | null
  session: VaultSession | null
  exportRecoveryBackup?: ExportRecoveryBackup
}) {
  const { readDraft, discardDraftAndReload, keepEditing, remoteLocked, unlockRemote } = useVault()
  const phraseId = useId()
  const [phrase, setPhrase] = useState('')
  const [phraseError, setPhraseError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function continueWithPassphrase(event: FormEvent) {
    event.preventDefault()
    const attempt = phrase
    setPhrase('')
    setBusy(true)
    setPhraseError(null)
    const result = await unlockRemote(attempt)
    if (!result.ok) setPhraseError(result.message ?? 'The passphrase is incorrect.')
    setBusy(false)
  }

  async function exportBackup() {
    const draft = readDraft()
    if (!exportRecoveryBackup || !session || !draft) return
    setBusy(true)
    setStatus(null)
    try {
      await exportRecoveryBackup({ session, snapshot, draft })
      setStatus('Backup exported.')
    } catch (cause) {
      const detail = cause instanceof RecoveryExportError ? ` ${cause.message}` : ''
      setStatus(`Could not export a backup.${detail} Your draft is still here.`)
    }
    setBusy(false)
  }

  return <main className="support-screen vault-screen">
    <h1>This library changed in another tab</h1>
    <p>Your unsaved note has not been saved. Export a backup that includes it, keep editing it, or discard the note and unlock again.</p>
    {status && <p role="status">{status}</p>}
    {remoteLocked && <form className="vault-form" onSubmit={(event) => void continueWithPassphrase(event)}>
      <p>Scratch paused this tab while you were away. Enter the passphrase you unlocked it with to export a backup or keep editing.</p>
      <label htmlFor={phraseId}>Passphrase</label>
      <input id={phraseId} type="password" autoComplete="current-password" autoFocus value={phrase} disabled={busy} onChange={(event) => setPhrase(event.target.value)} />
      {phraseError && <p role="alert" className="form-error">{phraseError}</p>}
      <div className="dialog-actions"><button type="submit" disabled={busy || phrase === ''}>Continue</button></div>
    </form>}
    <div className="dialog-actions">
      {exportRecoveryBackup && <button className="primary-button" type="button" disabled={busy || remoteLocked} onClick={() => void exportBackup()}>Export backup</button>}
      <button type="button" disabled={busy || remoteLocked} onClick={keepEditing}>Keep editing</button>
      <button type="button" disabled={busy} onClick={discardDraftAndReload}>Discard draft and reload</button>
    </div>
  </main>
}
