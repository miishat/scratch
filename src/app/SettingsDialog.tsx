import { useState } from 'react'
import { Dialog } from '../components/Dialog'
import { exportBackup, saveBackupFile } from '../features/backup/backup'
import { useVault } from '../features/vault/VaultProvider'

type Props = { onClose: () => void, onChangePassphrase: () => void, onImportBackup: () => void }

export function SettingsDialog({ onClose, onChangePassphrase, onImportBackup }: Props) {
  const { requestLock, hasDirtyDraft, session } = useVault()
  const [exporting, setExporting] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  function lockNow() {
    onClose()
    requestLock()
  }
  async function exportNow() {
    if (!session) return
    setExporting(true)
    setStatus(null)
    setError(null)
    const result = await exportBackup(session)
    setExporting(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    saveBackupFile(result.blob, result.filename)
    setStatus('Backup exported.')
  }
  return <Dialog title="Settings" onRequestClose={onClose} canClose={() => true}>
    <section aria-labelledby="settings-security">
      <h3 id="settings-security">Security</h3>
      <p>Locking applies to this tab only. Other tabs stay unlocked until they lock.</p>
      <div className="dialog-actions">
        <button className="primary-button" type="button" onClick={lockNow}>Lock now</button>
        <button type="button" disabled={hasDirtyDraft} aria-describedby={hasDirtyDraft ? 'settings-passphrase-hint' : undefined} onClick={onChangePassphrase}>Change passphrase</button>
      </div>
      {hasDirtyDraft && <p id="settings-passphrase-hint" className="form-hint">Save or discard your unsaved note before changing the passphrase.</p>}
    </section>
    <section aria-labelledby="settings-backup">
      <h3 id="settings-backup">Backup</h3>
      <p>Stored in this browser. Export a backup to keep a copy.</p>
      <div className="dialog-actions">
        <button type="button" disabled={exporting} onClick={() => void exportNow()}>Export backup</button>
        <button type="button" disabled={hasDirtyDraft || exporting} aria-describedby={hasDirtyDraft ? 'settings-import-hint' : undefined} onClick={onImportBackup}>Import backup</button>
      </div>
      {hasDirtyDraft && <p id="settings-import-hint" className="form-hint">Save or discard the note you are writing before importing a backup.</p>}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
    </section>
  </Dialog>
}
