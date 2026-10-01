import { useEffect, useState, type ReactNode } from 'react'
import { AppHeader } from '../components/AppHeader'
import { EmptyState } from '../components/EmptyState'
import { ToastRegion } from '../components/ToastRegion'
import { CollectionView, type CollectionViewProps } from '../features/collections/CollectionView'
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
import { NavigationProvider } from './NavigationProvider'
import { useNavigation } from './useNavigation'

type ShellProps = { children?: ReactNode, onAddNote?: () => void, onAddCollection?: () => void, onSettings?: () => void, onHome?: () => void }

export function AppShell({ children, onAddNote, onAddCollection, onSettings, onHome }: ShellProps) {
  return <>
    <AppHeader onAddNote={onAddNote} onAddCollection={onAddCollection} onSettings={onSettings} onHome={onHome} />
    <main className="app-content">{children ?? <EmptyState onAddNote={onAddNote} onAddCollection={onAddCollection} />}</main>
    <ToastRegion />
  </>
}

type AppProps = Pick<ShellProps, 'children'> & Pick<CollectionViewProps, 'onAddNote' | 'onAddCollection' | 'onCopyNote' | 'onItemMenu' | 'renderNote'> & {
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

function UnlockedApp(props: AppProps) {
  const library = useLibrary()
  return <NavigationProvider items={library.snapshot?.items ?? null}><UnlockedShell {...props} /></NavigationProvider>
}

function LibraryContent({ onAddNote, onAddCollection, onCopyNote, onItemMenu, renderNote }: AppProps) {
  const library = useLibrary()
  if (library.snapshot) {
    return <CollectionView items={library.snapshot.items} onAddNote={onAddNote} onAddCollection={onAddCollection} onCopyNote={onCopyNote} onItemMenu={onItemMenu} renderNote={renderNote} />
  }
  if (library.status === 'error') {
    return <section className="empty-state" role="alert"><p>{library.error}</p><div className="empty-actions"><button type="button" onClick={() => void library.refresh()}>Try again</button></div></section>
  }
  return <p role="status">Opening your library.</p>
}

function UnlockedShell(props: AppProps) {
  const { children, exportRecoveryBackup, onAddNote, onAddCollection } = props
  const vault = useVault()
  const library = useLibrary()
  const navigation = useNavigation()
  const parentId = navigation.route.collectionId
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
      <AppShell
        onAddNote={onAddNote && (() => onAddNote(parentId))}
        onAddCollection={onAddCollection && (() => onAddCollection(parentId))}
        onSettings={() => setDialog('settings')}
        onHome={() => void navigation.openCollection(null)}
      >{children ?? <LibraryContent {...props} />}</AppShell>
    </div>
    {!hidden && dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} onChangePassphrase={() => setDialog('passphrase')} />}
    {!hidden && dialog === 'passphrase' && <ChangePassphraseDialog onClose={() => setDialog(null)} />}
    {lockError && <LockErrorPanel />}
    {!lockError && vault.remoteReplacement && <RemoteChangePanel snapshot={library.snapshot} session={vault.session} exportRecoveryBackup={exportRecoveryBackup} />}
  </>
}
