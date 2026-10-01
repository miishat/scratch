import { describe, expect, it, vi } from 'vitest'
import { createOfflineStore, type OfflineEnvironment, type RegisterCallbacks, type RegisterWorker } from '../src/features/offline/register'

// Registration state for the static service worker. None of this touches notes.

function fakeRegister() {
  let callbacks!: RegisterCallbacks
  const update = vi.fn(async () => undefined)
  const register: RegisterWorker = vi.fn((given) => {
    callbacks = given
    return update
  })
  return { register, update, callbacks: () => callbacks }
}

describe('offline registration state', () => {
  it('reports unsupported without registering when service workers are missing', () => {
    const store = createOfflineStore()
    const { register } = fakeRegister()
    store.start(register, false)
    expect(store.getState().support).toBe('unsupported')
    expect(register).not.toHaveBeenCalled()
  })

  it('moves from registering to registered and offline-ready', () => {
    const store = createOfflineStore()
    const fake = fakeRegister()
    store.start(fake.register, true)
    expect(store.getState().support).toBe('registering')
    fake.callbacks().onRegisteredSW()
    fake.callbacks().onOfflineReady()
    expect(store.getState()).toEqual({ support: 'registered', offlineReady: true, updateReady: false })
    store.dismissOfflineReady()
    expect(store.getState().offlineReady).toBe(false)
  })

  it('records a registration failure without throwing', () => {
    const store = createOfflineStore()
    const fake = fakeRegister()
    store.start(fake.register, true)
    fake.callbacks().onRegisterError()
    expect(store.getState().support).toBe('failed')
  })

  it('treats a registrar that throws as a failure', () => {
    const store = createOfflineStore()
    store.start(() => { throw new Error('blocked') }, true)
    expect(store.getState().support).toBe('failed')
  })

  it('notifies subscribers and flags a waiting update, activating only when asked', async () => {
    const reload = vi.fn()
    const environment: OfflineEnvironment = { onControllerChange: (callback) => { queueMicrotask(callback) }, reload, activationTimeoutMs: 100 }
    const store = createOfflineStore(environment)
    const fake = fakeRegister()
    const listener = vi.fn()
    store.subscribe(listener)
    store.start(fake.register, true)
    fake.callbacks().onNeedRefresh()
    expect(store.getState().updateReady).toBe(true)
    expect(listener).toHaveBeenCalled()
    expect(fake.update).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    await store.activateUpdate()
    expect(fake.update).toHaveBeenCalledWith(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads only after the new worker takes control, and gives up if it never does', async () => {
    const reload = vi.fn()
    let takeControl = () => {}
    const environment: OfflineEnvironment = { onControllerChange: (callback) => { takeControl = callback }, reload, activationTimeoutMs: 20 }
    const store = createOfflineStore(environment)
    const fake = fakeRegister()
    store.start(fake.register, true)
    const waiting = store.activateUpdate()
    await Promise.resolve()
    expect(reload).not.toHaveBeenCalled()
    takeControl()
    await waiting
    expect(reload).toHaveBeenCalledTimes(1)

    reload.mockClear()
    const stuck = createOfflineStore({ ...environment, onControllerChange: () => {} })
    stuck.start(fake.register, true)
    await expect(stuck.activateUpdate()).rejects.toThrow()
    expect(reload).not.toHaveBeenCalled()
  })

  it('starts only once', () => {
    const store = createOfflineStore()
    const fake = fakeRegister()
    store.start(fake.register, true)
    store.start(fake.register, true)
    expect(fake.register).toHaveBeenCalledTimes(1)
  })
})
