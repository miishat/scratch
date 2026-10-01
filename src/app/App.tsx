import { useEffect, useState, type ReactNode } from 'react'
import { AppHeader } from '../components/AppHeader'
import { EmptyState } from '../components/EmptyState'
import { ToastRegion } from '../components/ToastRegion'
import { LibraryProvider, useLibrary } from '../features/library/LibraryProvider'
import { missingRequiredApis } from '../features/support/requiredApis'
import { UnsupportedBrowserScreen } from '../features/support/SupportScreens'
import { ChangePassphraseDialog } from '../features/vault/ChangePassphraseDialog'
import { useVault, VaultProvider } from '../features/vault/VaultProvider'
import {
  LockErrorPanel,
  RemoteChangePanel,
  VaultScreen,
  type ExportRecoveryBackup,
} from '../features/vault/VaultScreen'
import { SettingsDialog } from './SettingsDialog'

type ShellProps = { children?: ReactNode, onAdd?: () => void, onAddNote?: () => void, onAddCollection?: () => void, onSettings?: () => void }

export function AppShell({ children, onAdd, onAddNote, onAddCollection, onSettings }: ShellProps) {
  return <>
    <AppHeader onAdd={onAdd} onSettings={onSettings} />
    <main className="app-content">{children ?? <EmptyState onAddNote={onAddNote} onAddCollection={onAddCollection} />}</main>
    <ToastRegion />
  </>
}

type AppProps = ShellProps & {
  // Wired to the backup helper later; the recovery panel hides its export button
  // until a handler exists, so no broken control ships.
  exportRecoveryBackup?: ExportRecoveryBackup
  onImportBackup?: () => void
}

export function App(props: AppProps) {
  const missing = missingRequiredApis()
  if (missing.length) return <UnsupportedBrowserScreen missingApis={missing} />
  return <VaultProvider><VaultGate {...props} /></VaultProvider>
}

// The library is only mounted while a vault session exists, so nothing decrypted
// is reachable from a locked tab.
function VaultGate(props: AppProps) {
  const vault = useVault()
  if (vault.state !== 'unlocked' && vault.state !== 'lock-error') return <VaultScreen onImportBackup={props.onImportBackup} />
  return <LibraryProvider session={vault.session}><UnlockedApp {...props} /></LibraryProvider>
}

function UnlockedApp({ children, exportRecoveryBackup, onAdd, onAddNote, onAddCollection }: AppProps) {
  const vault = useVault()
  const library = useLibrary()
  const [dialog, setDialog] = useState<'settings' | 'passphrase' | null>(null)
  const { holdRefresh } = library
  const { hasDirtyDraft } = vault

  // A dirty editor must not have its library replaced underneath it.
  useEffect(() => {
    if (!hasDirtyDraft) return
    return holdRefresh()
  }, [hasDirtyDraft, holdRefresh])

  const lockError = vault.state === 'lock-error'
  const hidden = vault.concealed || lockError || vault.remoteReplacement
  return <>
    <div hidden={hidden} inert={hidden}>
      <AppShell onAdd={onAdd} onAddNote={onAddNote} onAddCollection={onAddCollection} onSettings={() => setDialog('settings')}>{children}</AppShell>
    </div>
    {!hidden && dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} onChangePassphrase={() => setDialog('passphrase')} />}
    {!hidden && dialog === 'passphrase' && <ChangePassphraseDialog onClose={() => setDialog(null)} />}
    {lockError && <LockErrorPanel />}
    {!lockError && vault.remoteReplacement && <RemoteChangePanel snapshot={library.snapshot} session={vault.session} exportRecoveryBackup={exportRecoveryBackup} />}
  </>
}
