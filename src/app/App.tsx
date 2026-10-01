import { AppHeader } from '../components/AppHeader'
import type { ReactNode } from 'react'
import { EmptyState } from '../components/EmptyState'
import { ToastRegion } from '../components/ToastRegion'
import { missingRequiredApis } from '../features/support/requiredApis'
import { UnsupportedBrowserScreen } from '../features/support/SupportScreens'

type AppProps = { children?: ReactNode, onAdd?: () => void, onAddNote?: () => void, onAddCollection?: () => void, onSettings?: () => void }

export function App({ children, onAdd, onAddNote, onAddCollection, onSettings }: AppProps) {
  const missing = missingRequiredApis()
  if (missing.length) return <UnsupportedBrowserScreen missingApis={missing} />
  return <>
    <AppHeader onAdd={onAdd} onSettings={onSettings} />
    <main className="app-content">{children ?? <EmptyState onAddNote={onAddNote} onAddCollection={onAddCollection} />}</main>
    <ToastRegion />
  </>
}
