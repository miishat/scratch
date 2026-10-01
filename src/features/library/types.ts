import type { CipherEnvelope, VaultHeader } from '../vault/types'

// Shared model for the Scratch library. These names and shapes are pinned by the
// implementation plan; Tasks 3, 4, 6, 8, and 9 consume them.

export type ItemId = string
export type VaultId = string
export type Generation = number
export type ItemKind = 'collection' | 'note'
export type CollectionColor = 'sage' | 'clay' | 'ochre' | 'slate'

// A decrypted item. Structural fields (id, vaultId, parentId, kind, version,
// timestamps) are unencrypted; title, body, isSecret, and color are encrypted at
// rest and only exist here while the library is unlocked.
export interface LibraryItem {
  id: ItemId
  vaultId: VaultId
  parentId: ItemId | null
  kind: ItemKind
  version: number
  createdAt: number
  updatedAt: number
  title: string | null
  body: string | null
  isSecret: boolean
  color: CollectionColor | null
}

// A stored item replaces the decrypted payload with an authenticated envelope.
export interface StoredItem {
  id: ItemId
  vaultId: VaultId
  parentId: ItemId | null
  kind: ItemKind
  version: number
  createdAt: number
  updatedAt: number
  payload: CipherEnvelope
}

export interface MetaRecord {
  revision: number
  generation: Generation
}

export interface LibrarySnapshot {
  header: VaultHeader
  meta: MetaRecord
  items: LibraryItem[]
}

export interface NoteInput {
  parentId: ItemId | null
  title: string | null
  body: string
  isSecret: boolean
}

export interface CollectionInput {
  parentId: ItemId | null
  title: string
  color: CollectionColor
}

export interface MutationContext {
  generation: Generation
  expectedRevision: number
  expectedVersion?: number
}

export type MutationFailureCode =
  | 'validation'
  | 'conflict'
  | 'vault-changed'
  | 'quota'
  | 'unavailable'
  | 'corrupt'

export interface MutationFailure {
  code: MutationFailureCode
  message: string
}

export type MutationResult =
  | { ok: true; snapshot: LibrarySnapshot }
  | ({ ok: false } & MutationFailure)

export const APP_LIMITS = {
  maxItems: 1000,
  maxCollectionDepth: 8,
  titleMaxGraphemes: 80,
  titleMaxBytes: 1024,
  bodyMaxBytes: 10000,
  passphraseMinCodePoints: 12,
  passphraseMaxBytes: 256,
  importMaxBytes: 32 * 1024 * 1024,
} as const
