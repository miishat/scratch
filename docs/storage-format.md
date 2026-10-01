# Scratch storage format

This document describes the exact on-disk and backup format Scratch uses to
protect note content at rest, and the limits of that protection. The
authoritative implementation is `src/features/vault/crypto.ts` and
`src/features/library/types.ts`.

## What is encrypted

Scratch stores one library per browser origin in IndexedDB. Every item carries
unencrypted structural metadata and an encrypted payload:

- **Unencrypted (structural):** `id`, `vaultId`, `parentId`, `kind`,
  `version`, `createdAt`, `updatedAt`.
- **Encrypted (payload):** `title`, `body`, `isSecret`, and `color`.

Encryption hides note titles, bodies, the secret flag, and collection colors. It
does not hide the number of items, the collection tree shape, or the IDs and
timestamps. There is no plaintext search index or persisted editor draft.

## Records

### Vault header

The serialized vault header is:

| Field | Meaning |
| --- | --- |
| `formatVersion` | Always `1`. Any other value is rejected before work. |
| `vaultId` | A UUID string identifying this vault. |
| `salt` | Base64 of a 16-byte random salt for PBKDF2. |
| `iterations` | The PBKDF2-SHA-256 count. Only `600000` is accepted. |
| `wrappedDataKey` | A base64 envelope (nonce plus ciphertext) holding the AES-GCM wrapped 32-byte data key. |

### Item record

A stored item has the six structural fields above plus a `payload` envelope. A
collection payload serializes `{ "title", "color" }`; a note payload serializes
`{ "title", "body", "isSecret" }`. The envelope is base64 `{ "nonce",
"ciphertext" }` where the ciphertext includes the 128-bit authentication tag.

### Meta

`MetaRecord` holds `revision` (incremented on every write) and `generation`
(changed only by imports). Neither is encrypted.

## Algorithm parameters

- **Data key:** AES-GCM-256, a fresh 32-byte random key per vault, imported as
  nonextractable and held only in memory.
- **Wrapping key:** PBKDF2-SHA-256 over the UTF-8 passphrase with a fresh 16-byte
  salt and exactly `600000` iterations. Any other iteration count is rejected
  before derivation begins.
- **Encryption:** AES-GCM with a fresh 12-byte random nonce for every operation
  and a 128-bit authentication tag. Nonces are never reused.

The data key is wrapped (not re-derived) by encrypting its raw bytes under the
wrapping key. Changing the passphrase rewraps the same data key with a new salt
and nonce; it does not reencrypt any note.

## Canonical associated data

Associated data is the UTF-8 encoding of a JSON array. The order is fixed; any
change breaks authentication of existing data.

1. **Item** (`["scratch-item", 1, vaultId, id, parentId, kind, version, createdAt, updatedAt]`).
   A null `parentId` serializes as JSON `null`. The `1` is the format version.
2. **Wrap** (`["scratch-wrap", 1, vaultId, saltBase64, iterations]`).
3. **Envelope** (`["scratch-envelope", 1, vaultId, purpose]`), where `purpose`
   is `"backup"` or `"draft"`.

The item AAD authenticates every structural field, so changing a parent, kind,
version, or timestamp makes the item fail authentication with no plaintext
produced. The envelope AAD binds a purpose so a backup envelope cannot be
opened as a draft.

## Backup format

A backup is a UTF-8 JSON `.scratch` file. Outer fields are `format`
(`"scratch-backup"`), `formatVersion` (`1`), `exportedAt`, the `VaultHeader`,
and one authenticated snapshot envelope. The envelope plaintext is the vault ID
plus the complete list of stored records sorted by ID. The envelope
authenticates the whole set, so a missing, reordered, or tampered record cannot
be mistaken for a complete library. The complete backup remains encrypted;
theme preference and search queries are never exported.

## Limits

- 1,000 items per library.
- Eight collection levels (0-based depth 0 through 7).
- Titles: 80 grapheme clusters and 1,024 UTF-8 bytes.
- Bodies: 10,000 UTF-8 bytes.
- Passphrases: at least 12 Unicode code points and at most 256 UTF-8 bytes.
- Import files: 32 MiB.

Byte counts use `TextEncoder`; grapheme clusters use `Intl.Segmenter`. These
APIs are required rather than substituted with an incorrect count.

## What protection means (and does not mean)

Encryption protects content at rest in IndexedDB and in exported files. It does
not protect an unlocked web page: once a vault is open, the app holds the data
key and decrypted items in memory, and a compromised same-origin script or
deliberate clipboard copy still exposes usable plaintext. JavaScript memory
cannot be guaranteed to be securely erased; Scratch releases references and
clears UI state rather than claiming zeroization.

Locking is per tab. A reload always begins locked; another unlocked tab holds
its own session and timer. Exported backups retain the passphrase they were
exported with, so changing the passphrase does not change an old backup's
passphrase.

## Session and locking

An unlocked session exists only in memory. Locking is current-tab only: it
releases this tab's data key and decrypted state and does not lock other tabs or
change stored data. A session locks after ten minutes without keyboard, pointer,
or touch activity, and after sixty seconds with the tab hidden; secrets are
concealed as soon as the tab is hidden, and a tab that resumes past either
deadline locks before showing content. An unsaved note draft is sealed into a
draft-purpose envelope held in memory only, and is offered back only after
unlocking the same vault and generation. If sealing fails, the tab stays
concealed and offers Save or Discard instead of reporting Locked. When another
tab replaces the vault or its header, a tab without a dirty draft releases its
session; a tab with a dirty draft keeps it concealed until the user exports a
backup or discards the draft.
