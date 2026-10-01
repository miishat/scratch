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
  // The library's request to reload because a new worker took control. The store
  // reloads only for an activation this tab started; see activateUpdate.
  onNeedReload: () => void
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
  // True from the moment this tab asks the worker to activate until the attempt
  // times out or fails. Only then may a takeover reload the page.
  let initiated = false
  // A new worker already controls this page without this tab having asked (another
  // tab approved the update), so the running scripts may not match the cache.
  let takenOver = false
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
          onNeedReload: () => {
            if (initiated) return
            // Another tab (or a late takeover) updated the worker. Reloading here
            // could discard an unsaved draft, so the page keeps running and the
            // update notice stays until the person chooses.
            takenOver = true
            set({ updateReady: true })
          },
          onOfflineReady: () => set({ offlineReady: true }),
          onRegisteredSW: () => set({ support: 'registered' }),
          onRegisterError: () => set({ support: 'failed' }),
        })
      } catch {
        set({ support: 'failed' })
      }
    },
    // The worker library reloads on its own whenever a new worker takes control
    // (its reload argument is ignored in prompt mode) unless onNeedReload is passed.
    // It is passed, so this method is the only place that reloads for an update
    // this tab asked for.
    async activateUpdate() {
      if (!updateWorker) throw new Error('No worker to update.')
      if (takenOver) {
        // Nothing is left to activate; only this page's stale scripts remain.
        environment.reload()
        return
      }
      const activate = updateWorker
      initiated = true
      await new Promise<void>((resolve, reject) => {
        // A late takeover after giving up must not reload the page unasked: this
        // listener is removed on timeout, and onNeedReload then treats the takeover
        // as external (notice only).
        let stopListening = () => {}
        const timer = setTimeout(() => {
          initiated = false
          stopListening()
          reject(new Error('The update did not activate.'))
        }, environment.activationTimeoutMs)
        stopListening = environment.onControllerChange(() => {
          clearTimeout(timer)
          resolve()
        })
        activate(false).catch((cause: unknown) => {
          clearTimeout(timer)
          initiated = false
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
