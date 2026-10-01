import { useEffect } from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createVault } from '../src/features/vault/crypto'
import type { CreatedVault } from '../src/features/vault/types'
import type { MutationResult } from '../src/features/library/types'
import { createNote, initializeLibrary, loadLibrary, resetRepositoryForTests } from '../src/features/library/repository'
import { closeDatabase, deleteDatabase, useDatabaseName } from '../src/features/library/database'
import { LibraryProvider, useLibrary, type LibraryContextValue } from '../src/features/library/LibraryProvider'

// The provider is the only place a decrypted snapshot is held, so these cases
// pin its mandated semantics: clear on lock, replace only on committed success,
// and never turn a failed mutation into an apparent success.

vi.mock('../src/features/library/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/library/repository')>()
  return { ...actual, loadLibrary: vi.fn(actual.loadLibrary) }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

let vault: CreatedVault
let dbName: string
// Written from an effect (never during render) so tests can read the live context.
const captured: { value: LibraryContextValue | null } = { value: null }

beforeAll(async () => {
  vault = await createVault('correct horse battery staple')
}, 30000)

beforeEach(() => {
  dbName = `scratch-provider-${crypto.randomUUID()}`
  useDatabaseName(dbName)
  resetRepositoryForTests()
  captured.value = null
})

afterEach(async () => {
  await closeDatabase()
  await deleteDatabase(dbName)
  resetRepositoryForTests()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function Probe() {
  const library = useLibrary()
  useEffect(() => {
    captured.value = library
  })
  return <div data-testid="status">{library.status}</div>
}

describe('LibraryProvider semantics', () => {
  it('loads while unlocked and clears the decrypted snapshot when the session ends', async () => {
    const init = await initializeLibrary(vault)
    if (!init.ok) throw new Error(init.message)
    const { rerender } = render(
      <LibraryProvider session={init.session}>
        <Probe />
      </LibraryProvider>,
    )
    await waitFor(() => expect(captured.value?.status).toBe('ready'))
    expect(captured.value?.snapshot?.items).toHaveLength(0)

    rerender(
      <LibraryProvider session={null}>
        <Probe />
      </LibraryProvider>,
    )
    await waitFor(() => expect(captured.value?.snapshot).toBeNull())
    expect(captured.value?.status).toBe('locked')
  })

  it('replaces the snapshot only on a committed mutation and never reports failure as success', async () => {
    const init = await initializeLibrary(vault)
    if (!init.ok) throw new Error(init.message)
    render(
      <LibraryProvider session={init.session}>
        <Probe />
      </LibraryProvider>,
    )
    await waitFor(() => expect(captured.value?.status).toBe('ready'))
    const before = captured.value!.snapshot!
    expect(before.meta.revision).toBe(1)

    const failed: MutationResult[] = []
    await act(async () => {
      failed.push(await captured.value!.runMutation(async () => ({ ok: false, code: 'quota', message: 'no space' })))
    })
    expect(failed).toHaveLength(1)
    expect(failed[0].ok).toBe(false)
    expect(captured.value?.snapshot).toBe(before)
    expect(captured.value?.status).toBe('ready')

    const succeeded: MutationResult[] = []
    await act(async () => {
      succeeded.push(
        await captured.value!.runMutation((session, context) =>
          createNote(session, context, { parentId: null, title: null, body: 'provider note', isSecret: false }),
        ),
      )
    })
    expect(succeeded).toHaveLength(1)
    expect(succeeded[0].ok).toBe(true)
    expect(captured.value?.snapshot?.items).toHaveLength(1)
    expect(captured.value?.snapshot?.meta.revision).toBe(before.meta.revision + 1)
  })

  it('clearUnlockedState drops the decrypted snapshot immediately', async () => {
    const init = await initializeLibrary(vault)
    if (!init.ok) throw new Error(init.message)
    render(
      <LibraryProvider session={init.session}>
        <Probe />
      </LibraryProvider>,
    )
    await waitFor(() => expect(captured.value?.status).toBe('ready'))
    expect(captured.value?.snapshot).not.toBeNull()

    act(() => {
      captured.value!.clearUnlockedState()
    })
    expect(captured.value?.snapshot).toBeNull()
    expect(captured.value?.status).toBe('locked')
  })

  it('drops a pending refresh that resolves after the session ends', async () => {
    const init = await initializeLibrary(vault)
    if (!init.ok) throw new Error(init.message)
    const { rerender } = render(
      <LibraryProvider session={init.session}>
        <Probe />
      </LibraryProvider>,
    )
    await waitFor(() => expect(captured.value?.status).toBe('ready'))

    const actual = await vi.importActual<typeof import('../src/features/library/repository')>(
      '../src/features/library/repository',
    )
    const gate = deferred<void>()
    vi.mocked(loadLibrary).mockImplementationOnce(async (session) => {
      await gate.promise
      return actual.loadLibrary(session)
    })
    let pending!: Promise<void>
    act(() => {
      pending = captured.value!.refresh()
    })
    rerender(
      <LibraryProvider session={null}>
        <Probe />
      </LibraryProvider>,
    )
    await waitFor(() => expect(captured.value?.status).toBe('locked'))
    await act(async () => {
      gate.resolve()
      await pending
    })
    expect(captured.value?.snapshot).toBeNull()
    expect(captured.value?.status).toBe('locked')
  })

  it('returns a mutation committed after lock to its caller without restoring the snapshot', async () => {
    const init = await initializeLibrary(vault)
    if (!init.ok) throw new Error(init.message)
    const { rerender } = render(
      <LibraryProvider session={init.session}>
        <Probe />
      </LibraryProvider>,
    )
    await waitFor(() => expect(captured.value?.status).toBe('ready'))

    const gate = deferred<void>()
    let pending!: Promise<MutationResult>
    act(() => {
      pending = captured.value!.runMutation(async (session, context) => {
        await gate.promise
        return createNote(session, context, { parentId: null, title: null, body: 'late note', isSecret: false })
      })
    })
    rerender(
      <LibraryProvider session={null}>
        <Probe />
      </LibraryProvider>,
    )
    await waitFor(() => expect(captured.value?.status).toBe('locked'))
    let result!: MutationResult
    await act(async () => {
      gate.resolve()
      result = await pending
    })
    expect(result.ok).toBe(true)
    expect(captured.value?.snapshot).toBeNull()
    expect(captured.value?.status).toBe('locked')
  })

  it.skipIf(typeof BroadcastChannel === 'undefined')(
    'flags a remote change while held without replacing the snapshot, then reloads on release',
    async () => {
      const init = await initializeLibrary(vault)
      if (!init.ok) throw new Error(init.message)
      render(
        <LibraryProvider session={init.session}>
          <Probe />
        </LibraryProvider>,
      )
      await waitFor(() => expect(captured.value?.status).toBe('ready'))
      const before = captured.value!.snapshot!
      expect(captured.value?.remoteChangePending).toBe(false)

      let release!: () => void
      act(() => {
        release = captured.value!.holdRefresh()
      })
      const callsBefore = vi.mocked(loadLibrary).mock.calls.length
      const channel = new BroadcastChannel('scratch-v1-changes')
      try {
        channel.postMessage({ vaultId: before.header.vaultId, generation: before.meta.generation, revision: 99 })
        await waitFor(() => expect(captured.value?.remoteChangePending).toBe(true))
      } finally {
        channel.close()
      }
      expect(captured.value?.snapshot).toBe(before)
      expect(vi.mocked(loadLibrary).mock.calls.length).toBe(callsBefore)

      act(() => {
        release()
      })
      await waitFor(() => expect(captured.value?.remoteChangePending).toBe(false))
      await waitFor(() => expect(captured.value?.snapshot).not.toBe(before))
      expect(vi.mocked(loadLibrary).mock.calls.length).toBe(callsBefore + 1)
    },
  )

  it.skipIf(typeof BroadcastChannel === 'undefined')(
    'ignores a hold released after lock and never reloads or restores the snapshot',
    async () => {
      const init = await initializeLibrary(vault)
      if (!init.ok) throw new Error(init.message)
      const { rerender } = render(
        <LibraryProvider session={init.session}>
          <Probe />
        </LibraryProvider>,
      )
      await waitFor(() => expect(captured.value?.status).toBe('ready'))
      const before = captured.value!.snapshot!

      let release!: () => void
      act(() => {
        release = captured.value!.holdRefresh()
      })
      const channel = new BroadcastChannel('scratch-v1-changes')
      try {
        channel.postMessage({ vaultId: before.header.vaultId, generation: before.meta.generation, revision: 99 })
        await waitFor(() => expect(captured.value?.remoteChangePending).toBe(true))
      } finally {
        channel.close()
      }
      rerender(
        <LibraryProvider session={null}>
          <Probe />
        </LibraryProvider>,
      )
      await waitFor(() => expect(captured.value?.status).toBe('locked'))
      const callsBefore = vi.mocked(loadLibrary).mock.calls.length

      await act(async () => {
        release()
        await new Promise((resolve) => setTimeout(resolve, 50))
      })
      expect(vi.mocked(loadLibrary).mock.calls.length).toBe(callsBefore)
      expect(captured.value?.snapshot).toBeNull()
      expect(captured.value?.status).toBe('locked')
    },
  )

  async function mountReady() {
    const init = await initializeLibrary(vault)
    if (!init.ok) throw new Error(init.message)
    const view = render(
      <LibraryProvider session={init.session}>
        <Probe />
      </LibraryProvider>,
    )
    await waitFor(() => expect(captured.value?.status).toBe('ready'))
    return { init, view, before: captured.value!.snapshot! }
  }

  async function postRemoteChange(before: { header: { vaultId: string }; meta: { generation: number } }) {
    const channel = new BroadcastChannel('scratch-v1-changes')
    try {
      channel.postMessage({ vaultId: before.header.vaultId, generation: before.meta.generation, revision: 99 })
      await new Promise((resolve) => setTimeout(resolve, 60))
    } finally {
      channel.close()
    }
  }

  it.skipIf(typeof BroadcastChannel === 'undefined')(
    'clearUnlockedState resets holds so a later remote change is neither held nor applied',
    async () => {
      const { before } = await mountReady()
      let release!: () => void
      act(() => {
        release = captured.value!.holdRefresh()
      })
      act(() => {
        captured.value!.clearUnlockedState()
      })
      act(() => {
        release()
      })
      const callsBefore = vi.mocked(loadLibrary).mock.calls.length
      await act(async () => {
        await postRemoteChange(before)
      })
      expect(captured.value?.remoteChangePending).toBe(false)
      expect(captured.value?.snapshot).toBeNull()
      expect(captured.value?.status).toBe('locked')
      expect(vi.mocked(loadLibrary).mock.calls.length).toBe(callsBefore)
    },
  )

  it.skipIf(typeof BroadcastChannel === 'undefined')(
    'a remote change after clearUnlockedState does not restore the snapshot',
    async () => {
      const { before } = await mountReady()
      act(() => {
        captured.value!.clearUnlockedState()
      })
      const callsBefore = vi.mocked(loadLibrary).mock.calls.length
      await act(async () => {
        await postRemoteChange(before)
      })
      expect(captured.value?.snapshot).toBeNull()
      expect(captured.value?.status).toBe('locked')
      expect(vi.mocked(loadLibrary).mock.calls.length).toBe(callsBefore)
    },
  )

  it.skipIf(typeof BroadcastChannel === 'undefined')(
    'an old session release does not drop a hold taken by a new session',
    async () => {
      const { init, view, before } = await mountReady()
      let releaseOld!: () => void
      act(() => {
        releaseOld = captured.value!.holdRefresh()
      })
      view.rerender(
        <LibraryProvider session={null}>
          <Probe />
        </LibraryProvider>,
      )
      await waitFor(() => expect(captured.value?.status).toBe('locked'))
      view.rerender(
        <LibraryProvider session={init.session}>
          <Probe />
        </LibraryProvider>,
      )
      await waitFor(() => expect(captured.value?.status).toBe('ready'))
      act(() => {
        captured.value!.holdRefresh()
      })
      act(() => {
        releaseOld()
      })
      const callsBefore = vi.mocked(loadLibrary).mock.calls.length
      await act(async () => {
        await postRemoteChange(before)
      })
      expect(captured.value?.remoteChangePending).toBe(true)
      expect(vi.mocked(loadLibrary).mock.calls.length).toBe(callsBefore)
    },
  )
})
