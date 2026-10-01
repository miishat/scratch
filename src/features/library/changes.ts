import type { Generation, VaultId } from './types'

// Cross-tab change notifications. They carry only identifiers and revisions so a
// receiving tab can reload clean state; they never carry content, queries, keys,
// or passphrases. BroadcastChannel is used when available; otherwise the tab
// falls back to refreshing when the window regains focus.

export interface ChangeNotification {
  vaultId: VaultId
  generation: Generation
  revision: number
}

// A null change means "reload and compare" from the focus fallback, which has no
// revision to report.
export type ChangeListener = (change: ChangeNotification | null) => void

export interface ChangeSubscription {
  unsubscribe(): void
}

const CHANNEL_NAME = 'scratch-v1-changes'

let channel: BroadcastChannel | null = null

function changeChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  if (!channel) {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME)
    } catch {
      channel = null
    }
  }
  return channel
}

function isChangeNotification(value: unknown): value is ChangeNotification {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.vaultId === 'string' &&
    typeof candidate.generation === 'number' &&
    typeof candidate.revision === 'number'
  )
}

// Publishing is best-effort: a closed or unavailable channel must never turn an
// already-committed mutation into a reported failure.
export function publishChange(change: ChangeNotification): void {
  const current = changeChannel()
  if (!current) return
  try {
    current.postMessage(change)
  } catch {
    // Ignore notification failures; the commit already succeeded.
  }
}

export function subscribeToChanges(listener: ChangeListener): ChangeSubscription {
  const deliver = (change: ChangeNotification | null): void => {
    listener(change)
  }

  const current = changeChannel()
  const onMessage = (event: MessageEvent): void => {
    deliver(isChangeNotification(event.data) ? event.data : null)
  }
  if (current) current.addEventListener('message', onMessage)

  const onFocus = (): void => {
    if (!current) deliver(null)
  }
  if (typeof window !== 'undefined') window.addEventListener('focus', onFocus)

  return {
    unsubscribe(): void {
      if (current) current.removeEventListener('message', onMessage)
      if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus)
    },
  }
}

// Release the shared channel. Used by test isolation; in the app the channel
// lives for the page.
export function closeChangeChannel(): void {
  if (channel) {
    channel.close()
    channel = null
  }
}
