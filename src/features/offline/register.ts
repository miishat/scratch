// Service worker registration state. The worker only precaches static build
// files; this module never touches notes, keys, or backups. Registration is
// optional: when it is unsupported or fails, the app keeps storing notes locally
// exactly as it does online.

export type OfflineSupport = 'idle' | 'unsupported' | 'registering' | 'registered' | 'failed'

export interface OfflineState {
  support: OfflineSupport
  // The first install finished caching the shell, so the app can open offline.
  offlineReady: boolean
  // A newer version is installed and waiting for the person to approve activation.
  updateReady: boolean
}

export interface RegisterCallbacks {
  onNeedRefresh: () => void
  onOfflineReady: () => void
  onRegisteredSW: () => void
  onRegisterError: () => void
}

// Matches the function vite-plugin-pwa exposes as `registerSW` in prompt mode.
export type RegisterWorker = (callbacks: RegisterCallbacks) => (reloadPage?: boolean) => Promise<void>

export interface OfflineStore {
  getState: () => OfflineState
  subscribe: (listener: () => void) => () => void
  start: (register: RegisterWorker, supported?: boolean) => void
  // Activates the waiting worker and reloads. Callers approve this first.
  activateUpdate: () => Promise<void>
  dismissOfflineReady: () => void
  dismissUpdate: () => void
}

export interface OfflineEnvironment {
  // Calls back once when a different worker takes control of this page. Returns a
  // function that stops listening.
  onControllerChange: (callback: () => void) => () => void
  reload: () => void
  // How long to wait for the new worker to take control before giving up.
  activationTimeoutMs: number
}

const browserEnvironment: OfflineEnvironment = {
  onControllerChange: (callback) => {
    navigator.serviceWorker.addEventListener('controllerchange', callback, { once: true })
    return () => navigator.serviceWorker.removeEventListener('controllerchange', callback)
  },
  reload: () => window.location.reload(),
  activationTimeoutMs: 10000,
}

export function createOfflineStore(environment: OfflineEnvironment = browserEnvironment): OfflineStore {
  let state: OfflineState = { support: 'idle', offlineReady: false, updateReady: false }
  let updateWorker: ((reloadPage?: boolean) => Promise<void>) | null = null
  let started = false
  const listeners = new Set<() => void>()

  function set(patch: Partial<OfflineState>): void {
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start(register, supported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      if (started) return
      started = true
      if (!supported) {
        set({ support: 'unsupported' })
        return
      }
      set({ support: 'registering' })
      try {
        updateWorker = register({
          onNeedRefresh: () => set({ updateReady: true }),
          onOfflineReady: () => set({ offlineReady: true }),
          onRegisteredSW: () => set({ support: 'registered' }),
          onRegisterError: () => set({ support: 'failed' }),
        })
      } catch {
        set({ support: 'failed' })
      }
    },
    // Reloading is done here rather than by the worker library, which skips the
    // reload when this page was itself claimed by the first install.
    async activateUpdate() {
      if (!updateWorker) throw new Error('No worker to update.')
      const activate = updateWorker
      await new Promise<void>((resolve, reject) => {
        // A late takeover after giving up must not reload the page unasked.
        let stopListening = () => {}
        const timer = setTimeout(() => {
          stopListening()
          reject(new Error('The update did not activate.'))
        }, environment.activationTimeoutMs)
        stopListening = environment.onControllerChange(() => {
          clearTimeout(timer)
          resolve()
        })
        activate(false).catch((cause: unknown) => {
          clearTimeout(timer)
          stopListening()
          reject(cause)
        })
      })
      environment.reload()
    },
    dismissOfflineReady: () => set({ offlineReady: false }),
    dismissUpdate: () => set({ updateReady: false }),
  }
}

// The one store the running app uses; main.tsx starts it.
export const offlineStore = createOfflineStore()
