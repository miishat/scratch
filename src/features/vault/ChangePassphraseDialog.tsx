import { useId, useState, type FormEvent } from 'react'
import { Dialog } from '../../components/Dialog'
import { advanceOnEnter } from './advanceOnEnter'
import { useVault } from './VaultProvider'

export function ChangePassphraseDialog({ onClose }: { onClose: () => void }) {
  const { changePassphrase } = useVault()
  const currentId = useId()
  const nextId = useId()
  const confirmId = useId()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setDone(false)
    if (next !== confirm) {
      setError('Passphrases do not match.')
      return
    }
    setError(null)
    setBusy(true)
    const result = await changePassphrase(current, next)
    setBusy(false)
    if (result.ok) {
      setCurrent('')
      setNext('')
      setConfirm('')
      setDone(true)
    } else {
      setError(result.message ?? 'Could not change the passphrase.')
    }
  }

  return <Dialog title="Change passphrase" onRequestClose={onClose} canClose={() => !busy}>
    <form className="vault-form" onSubmit={submit}>
      <label htmlFor={currentId}>Current passphrase</label>
      <input id={currentId} type="password" autoComplete="current-password" value={current} disabled={busy} onKeyDown={advanceOnEnter} onChange={(event) => setCurrent(event.target.value)} />
      <label htmlFor={nextId}>New passphrase</label>
      <input id={nextId} type="password" autoComplete="new-password" value={next} disabled={busy} onKeyDown={advanceOnEnter} onChange={(event) => setNext(event.target.value)} />
      <label htmlFor={confirmId}>Confirm new passphrase</label>
      <input id={confirmId} type="password" autoComplete="new-password" value={confirm} disabled={busy} onChange={(event) => setConfirm(event.target.value)} />
      {error && <p role="alert" className="form-error">{error}</p>}
      {done && <p role="status">Passphrase changed.</p>}
      <p className="form-hint">Backups exported earlier keep the passphrase they were exported with.</p>
      <div className="dialog-actions">
        <button className="primary-button" type="submit" disabled={busy}>Update passphrase</button>
      </div>
    </form>
  </Dialog>
}
