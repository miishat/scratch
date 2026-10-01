import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AppHeader } from '../components/AppHeader'
import { EmptyState } from '../components/EmptyState'
import { ToastRegion } from '../components/ToastRegion'
import { useOrganize } from '../features/collections/useOrganize'
import { CollectionView, type CollectionViewProps } from '../features/collections/CollectionView'
import { LibraryProvider, useLibrary } from '../features/library/LibraryProvider'
import type { ItemId, LibraryItem } from '../features/library/types'
import { NoteEditor } from '../features/notes/NoteEditor'
import type { EditorOutcome } from '../features/notes/useNoteDraft'
import { missingRequiredApis } from '../features/support/requiredApis'
import { UnsupportedBrowserScreen } from '../features/support/SupportScreens'
import { ChangePassphraseDialog } from '../features/vault/ChangePassphraseDialog'
import type { DraftContent } from '../features/vault/session'
import { useVault, VaultProvider } from '../features/vault/VaultProvider'
import {
  LockErrorPanel,
  RemoteChangePanel,
  VaultScreen,
  type ExportRecoveryBackup,
} from '../features/vault/VaultScreen'
import { SettingsDialog } from './SettingsDialog'
import { formatRoute } from './navigation'
import { NavigationProvider } from './NavigationProvider'
import { useNavigation } from './useNavigation'

type ShellProps = { children?: ReactNode, onAddNote?: () => void, onAddCollection?: () => void, onSettings?: () => void, onHome?: () => void, toast?: string }

export function AppShell({ children, onAddNote, onAddCollection, onSettings, onHome, toast }: ShellProps) {
  return <>
    <AppHeader onAddNote={onAddNote} onAddCollection={onAddCollection} onSettings={onSettings} onHome={onHome} />
    <main className="app-content">{children ?? <EmptyState onAddNote={onAddNote} onAddCollection={onAddCollection} />}</main>
    <ToastRegion message={toast} />
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

interface Composer {
  key: number
  parentId: ItemId | null
  // The route the editor was opened on; leaving it closes a clean editor.
  routeKey: string
  recovered?: DraftContent
}

const TOAST_MS = 4000

function UnlockedShell(props: AppProps) {
  const { children, exportRecoveryBackup } = props
  const vault = useVault()
  const library = useLibrary()
  const navigation = useNavigation()
  const parentId = navigation.route.collectionId
  const routeKey = formatRoute(navigation.route)
  const [dialog, setDialog] = useState<'settings' | 'passphrase' | null>(null)
  const [composer, setComposer] = useState<Composer | null>(null)
  const [recovery, setRecovery] = useState<{ noteId: ItemId, draft: DraftContent } | null>(null)
  const [toast, setToast] = useState('')
  const sequence = useRef(0)
  const pendingFocus = useRef<{ selector: string, expires: number } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const { holdRefresh } = library
  const { hasDirtyDraft, recoveredDraft, clearRecoveredDraft } = vault
  const { openNote } = navigation
  const items = library.snapshot?.items

  // A dirty editor must not have its library replaced underneath it.
  useEffect(() => {
    if (!hasDirtyDraft) return
    return holdRefresh()
  }, [hasDirtyDraft, holdRefresh])

  useEffect(() => () => clearTimeout(toastTimer.current), [])

  // A new-note editor belongs to the route it opened on; Back or a link closes
  // it when clean. A dirty one is guarded, so only a forced fallback gets here.
  if (composer && composer.routeKey !== routeKey && !hasDirtyDraft) setComposer(null)

  const openComposer = useCallback((target: ItemId | null, recovered?: DraftContent) => {
    sequence.current += 1
    setComposer({ key: sequence.current, parentId: target, routeKey, recovered })
  }, [routeKey])

  // A draft sealed by an automatic lock returns once the same vault is open
  // again: an edit goes back to its note, anything else to a new-note editor.
  useEffect(() => {
    if (!recoveredDraft || !items) return
    const target = recoveredDraft.noteId ? items.find((item) => item.id === recoveredDraft.noteId && item.kind === 'note') : undefined
    if (target) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRecovery({ noteId: target.id, draft: recoveredDraft })
      void openNote(target.parentId, target.id)
    } else {
      const wanted = recoveredDraft.input.parentId
      const usable = wanted === null || items.some((item) => item.id === wanted && item.kind === 'collection')
      openComposer(usable ? wanted : null, recoveredDraft)
    }
    clearRecoveredDraft()
  }, [recoveredDraft, items, openNote, openComposer, clearRecoveredDraft])

  // Focus goes back to where the person started: the Add control after a new
  // note, the note's tile after a read or edit. The tile exists only once the
  // grid is back, so the request waits for it briefly.
  useEffect(() => {
    const pending = pendingFocus.current
    if (!pending) return
    const target = document.querySelector<HTMLElement>(pending.selector)
    if (target) {
      pendingFocus.current = null
      target.focus()
    } else if (Date.now() > pending.expires) {
      pendingFocus.current = null
    }
  })

  function announce(message: string) {
    clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = setTimeout(() => setToast(''), TOAST_MS)
  }

  function finish(outcome: EditorOutcome, source: 'compose' | 'note', note?: LibraryItem) {
    if (outcome === 'saved') announce('Saved')
    if (outcome === 'saved-new') announce('Saved as a new note')
    if (source === 'compose') setComposer(null)
    if (outcome === 'navigated') return
    if (source === 'note' && note) void navigation.closeNote()
    const selector = source === 'note' && note && outcome !== 'saved-new'
      ? `a[href="${formatRoute({ collectionId: note.parentId, noteId: note.id })}"]`
      : '.header-add'
    pendingFocus.current = { selector, expires: Date.now() + 1000 }
  }

  const clearRecovery = useCallback(() => setRecovery(null), [])
  const organize = useOrganize(announce)
  const addNote = props.onAddNote ?? openComposer
  const addCollection = props.onAddCollection ?? organize.openCreate
  const renderNote = props.renderNote ?? ((note: LibraryItem) => <NoteEditor
    key={note.id}
    parentId={note.parentId}
    note={note}
    recovered={recovery?.noteId === note.id ? recovery.draft : undefined}
    onRecoveredUsed={clearRecovery}
    onClose={(outcome) => finish(outcome, 'note', note)}
  />)

  const lockError = vault.state === 'lock-error'
  const hidden = vault.concealed || lockError || vault.remoteReplacement
  return <>
    <div hidden={hidden} inert={hidden}>
      <AppShell
        onAddNote={() => addNote(parentId)}
        onAddCollection={() => addCollection(parentId)}
        onSettings={() => setDialog('settings')}
        onHome={() => void navigation.openCollection(null)}
        toast={toast}
      >{children ?? <LibraryContent {...props} onAddNote={addNote} onAddCollection={addCollection} onItemMenu={props.onItemMenu ?? organize.openMenu} renderNote={renderNote} />}</AppShell>
      {composer && <NoteEditor
        key={composer.key}
        parentId={composer.parentId}
        recovered={composer.recovered}
        onClose={(outcome) => finish(outcome, 'compose')}
      />}
    </div>
    {!hidden && organize.dialogs}
    {!hidden && dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} onChangePassphrase={() => setDialog('passphrase')} />}
    {!hidden && dialog === 'passphrase' && !hasDirtyDraft && <ChangePassphraseDialog onClose={() => setDialog(null)} />}
    {lockError && <LockErrorPanel />}
    {!lockError && vault.remoteReplacement && <RemoteChangePanel snapshot={library.snapshot} session={vault.session} exportRecoveryBackup={exportRecoveryBackup} />}
  </>
}
