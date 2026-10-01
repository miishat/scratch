import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Dialog } from '../../components/Dialog'
import { useVault } from '../vault/VaultProvider'
import type { VaultSession } from '../vault/types'
import { commitImport, exportBackup, prepareImport, saveBackupFile } from './backup'
import type { ImportBase, PreparedBackup } from './types'

// Import flow: choose a file, enter the backup passphrase, review the item count,
// then confirm. Nothing is written until Replace (or Import, on first use) is
// confirmed. The passphrase field is cleared after every attempt and the
// passphrase is never kept; only the prepared, authenticated records are.

export interface ReplaceTarget {
  session: VaultSession
  // The generation and revision of the library as it is at this moment. Read
  // right after the backup is reviewed, so any later change aborts the replace.
  currentBase: () => ImportBase
}

type Stage = 'choose' | 'checking' | 'review' | 'replacing'

interface Props {
  // Null for the first-use import from the setup screen, where no library exists.
  replace: ReplaceTarget | null
  onClose: () => void
  onImported: () => void
}

export function BackupDialog({ replace, onClose, onImported }: Props) {
  const { installSession, readDraft } = useVault()
  const fileId = useId()
  const phraseId = useId()
  const [stage, setStage] = useState<Stage>('choose')
  const [file, setFile] = useState<File | null>(null)
  const [phrase, setPhrase] = useState('')
  const [prepared, setPrepared] = useState<PreparedBackup | null>(null)
  const [base, setBase] = useState<ImportBase>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const busy = stage === 'checking' || stage === 'replacing' || exporting

  async function review(event: FormEvent) {
    event.preventDefault()
    if (!file) {
      setError('Choose a backup file.')
      return
    }
    const attempt = phrase
    setPhrase('')
    setError(null)
    setStatus(null)
    setStage('checking')
    const result = await prepareImport(file, attempt)
    if (!alive.current) return
    if (!result.ok) {
      setError(result.message)
      setStage('choose')
      return
    }
    setBase(replace ? replace.currentBase() : null)
    setPrepared(result.prepared)
    setStage('review')
  }

  async function confirm() {
    if (!prepared) return
    if (replace && readDraft()) {
      setError('Save or discard your unsaved note before replacing the library.')
      return
    }
    setError(null)
    setStage('replacing')
    // The commit and the install run to completion even if this dialog unmounts
    // (for example the tab was concealed): the library is already replaced by then.
    const result = await commitImport(prepared, base)
    if (!result.ok) {
      if (!alive.current) return
      setError(result.message)
      if (result.code === 'conflict' || result.code === 'vault-changed') {
        // The library moved on after it was reviewed: start over with a new review.
        setPrepared(null)
        setFile(null)
        setStage('choose')
      } else {
        setStage('review')
      }
      return
    }
    if (installSession(result.session, replace ? replace.session : null)) {
      onImported()
      return
    }
    // Scratch locked (or the session changed) while the library was being replaced.
    // The library is replaced; no session is installed and nothing is announced.
    if (!alive.current) return
    setPrepared(null)
    setFile(null)
    setError('The library was replaced, but Scratch locked first. Unlock with the backup passphrase to open it.')
    setStage('choose')
  }

  async function exportCurrent() {
    if (!replace) return
    setExporting(true)
    setError(null)
    setStatus(null)
    const result = await exportBackup(replace.session)
    if (!alive.current) return
    setExporting(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    saveBackupFile(result.blob, result.filename)
    setStatus('Current library exported.')
  }

  const count = prepared?.itemCount ?? 0
  const replacing = replace !== null
  return <Dialog title="Import backup" onRequestClose={onClose} canClose={() => !busy}>
    {(stage === 'choose' || stage === 'checking') && <form className="vault-form" onSubmit={review}>
      <p>{replacing
        ? 'Replace the library in this browser with the contents of a backup. Everything stored here now will be removed.'
        : 'Restore a library from a backup file.'}</p>
      <label htmlFor={fileId}>Backup file</label>
      <input id={fileId} type="file" accept=".scratch,application/octet-stream" disabled={busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      <label htmlFor={phraseId}>Backup passphrase</label>
      <input id={phraseId} type="password" autoComplete="off" value={phrase} disabled={busy} onChange={(event) => setPhrase(event.target.value)} />
      {error && <p role="alert" className="form-error">{error}</p>}
      {stage === 'checking' && <p role="status">Checking backup</p>}
      <div className="dialog-actions">
        <button className="primary-button" type="submit" disabled={busy}>Review backup</button>
        <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </form>}
    {(stage === 'review' || stage === 'replacing') && prepared && <div className="vault-form">
      <p>{`This backup contains ${count} ${count === 1 ? 'item' : 'items'}.`}</p>
      <p>The backup's passphrase becomes the passphrase for this library from now on. Your theme stays as it is.</p>
      {replacing && <p>Replacing removes everything currently in this library. This cannot be undone, so export a backup of it first if you may need it.</p>}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
      {stage === 'replacing' && <p role="status">{replacing ? 'Replacing library' : 'Importing library'}</p>}
      <div className="dialog-actions">
        {replacing && <button type="button" disabled={busy} onClick={() => void exportCurrent()}>Export current backup</button>}
        <button className="primary-button" type="button" disabled={busy} onClick={() => void confirm()}>{replacing ? 'Replace library' : 'Import library'}</button>
        <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </div>}
  </Dialog>
}
