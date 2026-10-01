import { createContext, useContext, type MouseEvent } from 'react'
import type { ItemId } from '../features/library/types'
import type { AppRoute } from './navigation'

// A guard decides whether navigation may leave the current screen. A dirty
// editor registers one that returns false to block, or resolves after asking the
// person to confirm. Returning true allows the move.
export type NavigationGuard = () => boolean | Promise<boolean>

export interface NavigationValue {
  route: AppRoute
  // Brief notice after a fallback; cleared by the next navigation.
  message: string | null
  navigate: (route: AppRoute) => Promise<boolean>
  openCollection: (id: ItemId | null) => Promise<boolean>
  openNote: (parentId: ItemId | null, noteId: ItemId) => Promise<boolean>
  closeNote: () => Promise<boolean>
  navigateBack: () => void
  registerGuard: (guard: NavigationGuard) => () => void
  // Tells the router these items were just deleted on purpose in this tab, so
  // falling back from a view of one of them is not reported as a missing item.
  acknowledgeDeletion: (ids: ItemId[]) => void
}

export const NavigationContext = createContext<NavigationValue | null>(null)

export function useNavigation(): NavigationValue {
  const value = useContext(NavigationContext)
  if (!value) throw new Error('useNavigation must be used within a NavigationProvider.')
  return value
}

// True for a plain primary click that should be handled in app. Modified clicks
// keep their browser meaning (new tab, new window).
export function isPlainClick(event: MouseEvent): boolean {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}
