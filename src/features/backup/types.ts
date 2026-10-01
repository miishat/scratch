import type { Generation, LibrarySnapshot, StoredItem, VaultId } from '../library/types'
import type { CipherEnvelope, VaultHeader, VaultSession } from '../vault/types'

// The portable backup file. Everything that is not structural vault metadata
// lives inside one authenticated snapshot envelope: the plaintext of that
// envelope is a BackupSnapshot. Theme preference and search queries are never
// part of a backup.

export const BACKUP_FORMAT = 'scratch-backup'
export const BACKUP_FORMAT_VERSION = 1

// The outer JSON object. The header's wrapper authenticates its own KDF fields;
// the envelope authenticates the vault ID and the complete record set.
export interface BackupFile {
  format: typeof BACKUP_FORMAT
  formatVersion: typeof BACKUP_FORMAT_VERSION
  exportedAt: string
  header: VaultHeader
  snapshot: CipherEnvelope
}

// Plaintext of the snapshot envelope: the vault ID plus every stored record,
// sorted by ID.
export interface BackupSnapshot {
  vaultId: VaultId
  records: StoredItem[]
}

export type BackupFailureCode =
  | 'too-large'
  | 'unsupported'
  | 'malformed'
  | 'unlock'
  | 'invalid'
  | 'invalid-draft'
  | 'stale'
  | 'conflict'
  | 'vault-changed'
  | 'quota'
  | 'unavailable'

// Failure messages are safe to show: they never include content or passphrases.
export interface BackupFailure {
  ok: false
  code: BackupFailureCode
  message: string
}

export interface BackupFileResult {
  ok: true
  blob: Blob
  filename: string
}

// A fully authenticated, decrypted, and validated backup that is staged but not
// written. The session is a staging session with a temporary generation; the
// library is only changed by commitImport after the person confirms.
export interface PreparedBackup {
  header: VaultHeader
  records: StoredItem[]
  itemCount: number
  session: VaultSession
}

export type PrepareResult = { ok: true; prepared: PreparedBackup } | BackupFailure

// The generation and revision of the library being replaced, as seen when the
// backup was reviewed. Null only for an initial import.
export type ImportBase = { generation: Generation; revision: number } | null

export type CommitResult =
  | { ok: true; session: VaultSession; snapshot: LibrarySnapshot }
  | BackupFailure

export type ExportResult = BackupFileResult | BackupFailure
