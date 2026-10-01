import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { BackupDialog } from '../features/backup/BackupDialog'
import { exportRecoveryBackup as buildRecoveryBackup, saveBackupFile } from '../features/backup/backup'
import { copyNote, type CopyResult } from '../features/clipboard/copy'
import { SearchResults } from '../features/search/SearchResults'
import { useSearch } from '../features/search/useSearch'
import { AppHeader } from '../components/AppHeader'
import { EmptyState } from '../components/EmptyState'
import { ToastRegion } from '../components/ToastRegion'
import { useOrganize } from '../features/collections/useOrganize'
import { CollectionView, type CollectionViewProps } from '../features/collections/CollectionView'
import { LibraryProvider, useLibrary } from '../features/library/LibraryProvider'
import type { ItemId, LibraryItem } from '../features/library/types'
import { NoteEditor } from '../features/notes/NoteEditor'
import type { EditorOutcome } from '../features/notes/useNoteDraft'
import { UpdateNotice } from '../features/offline/UpdateNotice'
import { missingRequiredApis } from '../features/support/requiredApis'
import { UnsupportedBrowserScreen } from '../features/support/SupportScreens'
import { ChangePassphraseDialog } from '../features/vault/ChangePassphraseDialog'
import type { DraftContent } from '../features/vault/session'
import { useVault, VaultProvider } from '../features/vault/VaultProvider'
import {
  LockErrorPanel,
  RecoveryExportError,
  RemoteChangePanel,
  VaultScreen,
  type ExportRecoveryBackup,
} from '../features/vault/VaultScreen'
import { SettingsDialog } from './SettingsDialog'
import { formatRoute } from './navigation'
import { NavigationProvider } from './NavigationProvider'
import { useNavigation } from './useNavigation'

type ShellProps = {
  children?: ReactNode
  onAddNote?: () => void
  onAddCollection?: () => void
  onSettings?: () => void
  onHome?: () => void
  toast?: string
  searchValue?: string
  onSearchChange?: (value: string) => void
  // Count-only announcement for the search results; never contains note text.
  searchStatus?: string
}

export function AppShell({ children, onAddNote, onAddCollection, onSettings, onHome, toast, searchValue, onSearchChange, searchStatus }: ShellProps) {
  return <>
    <AppHeader onAddNote={onAddNote} onAddCollection={onAddCollection} onSettings={onSettings} onHome={onHome} searchValue={searchValue} onSearchChange={onSearchChange} />
    <p className="visually-hidden" role="status">{searchStatus}</p>
    <main className="app-content">{children ?? <EmptyState onAddNote={onAddNote} onAddCollection={onAddCollection} />}</main>
    <ToastRegion message={toast} />
  </>
}

type AppProps = Pick<ShellProps, 'children'> & Pick<CollectionViewProps, 'onAddNote' | 'onAddCollection' | 'onCopyNote' | 'onItemMenu' | 'renderNote'> & {
  // Overrides for tests; the app wires the real backup helpers by default.
  exportRecoveryBackup?: ExportRecoveryBackup
  onImportBackup?: () => void
}

export function App(props: AppProps) {
  const missing = missingRequiredApis()
  if (missing.length) return <UnsupportedBrowserScreen missingApis={missing} />
  return <VaultProvider><VaultGate {...props} /><UpdateNotice /></VaultProvider>
}

// The library is only mounted while a vault session exists, so nothing decrypted
// is reachable from a locked tab.
function VaultGate(props: AppProps) {
  const vault = useVault()
  const [importing, setImporting] = useState(false)
  if (vault.state !== 'unlocked' && vault.state !== 'lock-error') {
    // First-use import; the dialog unmounts with the screen once the imported library is open.
    return <>
      <VaultScreen onImportBackup={props.onImportBackup ?? (() => setImporting(true))} />
      {importing && vault.state === 'setup' && <BackupDialog replace={null} onClose={() => setImporting(false)} onImported={() => setImporting(false)} />}
    </>
  }
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

// Builds the recovery backup from the old in-memory library plus the unsaved
// draft and hands it to the browser. A refusal carries a safe message for the panel.
const recoverToFile: ExportRecoveryBackup = async ({ session, snapshot, draft }) => {
  const result = await buildRecoveryBackup(session, snapshot, draft)
  if (!result.ok) throw new RecoveryExportError(result.message)
  saveBackupFile(result.blob, result.filename)
}

function UnlockedShell(props: AppProps) {
  const { children } = props
  const exportRecoveryBackup = props.exportRecoveryBackup ?? recoverToFile
  const vault = useVault()
  const library = useLibrary()
  const navigation = useNavigation()
  const parentId = navigation.route.collectionId
  const routeKey = formatRoute(navigation.route)
  const [dialog, setDialog] = useState<'settings' | 'passphrase' | 'import' | null>(null)
  const [composer, setComposer] = useState<Composer | null>(null)
  const [recovery, setRecovery] = useState<{ noteId: ItemId, draft: DraftContent } | null>(null)
  const [toast, setToast] = useState('')
  const sequence = useRef(0)
  const pendingFocus = useRef<{ selector: string, expires: number } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const alive = useRef(true)
  const { holdRefresh } = library
  const { hasDirtyDraft, recoveredDraft, clearRecoveredDraft } = vault
  const { openNote } = navigation
  const items = library.snapshot?.items
  const search = useSearch(items, routeKey)

  // A dirty editor must not have its library replaced underneath it.
  useEffect(() => {
    if (!hasDirtyDraft) return
    return holdRefresh()
  }, [hasDirtyDraft, holdRefresh])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      clearTimeout(toastTimer.current)
    }
  }, [])

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
    if (!alive.current) return
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

  // A copy settles after the user action; Copied is announced only on success
  // and never includes the text. A failure is shown by the tile that asked.
  async function copy(note: LibraryItem): Promise<CopyResult> {
    const result = await copyNote(note.body ?? '')
    if (result === 'copied') announce('Copied')
    return result
  }
  const onCopyNote = props.onCopyNote ?? copy

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
        searchValue={search.query}
        onSearchChange={search.setQuery}
        searchStatus={search.announcement}
      >
        {/* Hidden, not unmounted, so an open editor keeps its draft while results show. */}
        <div hidden={search.results !== null} inert={search.results !== null}>
          {children ?? <LibraryContent {...props} onAddNote={addNote} onAddCollection={addCollection} onCopyNote={onCopyNote} onItemMenu={props.onItemMenu ?? organize.openMenu} renderNote={renderNote} />}
        </div>
        {search.results && items && <SearchResults results={search.results} items={items} onCopyNote={onCopyNote} />}
      </AppShell>
      {composer && <NoteEditor
        key={composer.key}
        parentId={composer.parentId}
        recovered={composer.recovered}
        onClose={(outcome) => finish(outcome, 'compose')}
      />}
    </div>
    {!hidden && organize.dialogs}
    {!hidden && dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} onChangePassphrase={() => setDialog('passphrase')} onImportBackup={() => setDialog('import')} />}
    {!hidden && dialog === 'import' && vault.session && <BackupDialog
      replace={{
        session: vault.session,
        currentBase: () => library.snapshot ? { generation: library.snapshot.meta.generation, revision: library.snapshot.meta.revision } : null,
      }}
      onClose={() => setDialog(null)}
      onImported={() => {
        setDialog(null)
        announce('Library replaced')
        void navigation.openCollection(null)
      }}
    />}
    {!hidden && dialog === 'passphrase' && !hasDirtyDraft && <ChangePassphraseDialog onClose={() => setDialog(null)} />}
    {lockError && <LockErrorPanel />}
    {!lockError && vault.remoteReplacement && <RemoteChangePanel snapshot={library.snapshot} session={vault.session} exportRecoveryBackup={exportRecoveryBackup} />}
  </>
}
