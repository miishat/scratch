import { useSyncExternalStore } from 'react'
import { offlineStore, type OfflineState, type OfflineStore } from './register'

export function useOffline(store: OfflineStore = offlineStore): OfflineState {
  return useSyncExternalStore(store.subscribe, store.getState)
}
