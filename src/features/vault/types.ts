import type { Generation, VaultId } from '../library/types'

// Vault records and key sessions. The data key is never extractable and only
// lives in memory; the header is the only serialized key material.

export type SealPurpose = 'backup' | 'draft'

// A base64 nonce plus base64 ciphertext including the AES-GCM authentication tag.
export interface CipherEnvelope {
  nonce: string
  ciphertext: string
}

// The serialized vault record. formatVersion is always 1. salt and the wrapped
// data key carry base64 binary; iterations is the accepted PBKDF2 count 600000.
export interface VaultHeader {
  formatVersion: 1
  vaultId: VaultId
  salt: string
  iterations: number
  wrappedDataKey: CipherEnvelope
}

// Result of createVault: a header ready to persist plus the in-memory key.
export interface CreatedVault {
  header: VaultHeader
  dataKey: CryptoKey
}

// An unlocked session always has a generation, supplied by the repository after
// persistence (initializeLibrary) or on unlock.
export interface VaultSession {
  header: VaultHeader
  generation: Generation
  dataKey: CryptoKey
}

export type UnlockFailureCode =
  | 'unsupported-format'
  | 'unsupported-iterations'
  | 'malformed-header'
  | 'wrong-passphrase'

export interface UnlockFailure {
  code: UnlockFailureCode
  message: string
}

export type UnlockResult =
  | { ok: true; session: VaultSession }
  | ({ ok: false } & UnlockFailure)
