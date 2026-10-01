import { registerSW } from 'virtual:pwa-register'
import { offlineStore } from './register'

// Build-only wiring: the virtual module exists only in the Vite build, so unit
// tests exercise the store with an injected registrar instead of importing this.
export function startOffline(): void {
  offlineStore.start((callbacks) => registerSW({
    immediate: true,
    onNeedRefresh: callbacks.onNeedRefresh,
    onNeedReload: callbacks.onNeedReload,
    onOfflineReady: callbacks.onOfflineReady,
    onRegisteredSW: callbacks.onRegisteredSW,
    onRegisterError: callbacks.onRegisterError,
  }))
}
