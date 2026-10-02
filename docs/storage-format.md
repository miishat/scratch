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

A backup is a UTF-8 JSON file named `scratch-backup-YYYY-MM-DD-HHmm.scratch`
(local date and time). Its exact fields are:

| Field | Meaning |
| --- | --- |
| `format` | Always `"scratch-backup"`. |
| `formatVersion` | Always `1`. |
| `exportedAt` | ISO 8601 time of export. |
| `header` | The `VaultHeader` described above. Its wrapper authenticates the salt and iteration count. |
| `snapshot` | One `CipherEnvelope` sealed with the data key and the `"backup"` purpose. |

The snapshot plaintext is the UTF-8 JSON `{ "vaultId", "records" }`, where
`records` is the complete array of stored items (structural fields plus the
encrypted payload envelope) sorted by ID. The envelope authenticates the whole
set, so a missing, reordered, or tampered record cannot be mistaken for a
complete library. Titles, bodies, secret flags, and colors stay encrypted twice
over, and theme preference and search queries are never exported. Unknown or
extra fields are rejected.

The backup keeps the passphrase it was exported with: the header carries that
wrapper, so opening it needs that passphrase even if the library's passphrase
has changed since.

### Export

Export reads the header, meta, and all records in one readonly transaction, then
encrypts outside it. It first checks that the stored vault ID, generation, and
header wrapper still match the exporting session, and that every record
decrypts into a valid tree; otherwise it asks the person to refresh instead of
writing an ambiguous file. A file over 32 MiB is refused before download. The
object URL is released shortly after the download starts.

A tab whose library was replaced elsewhere while it holds an unsaved note uses
the recovery export instead. It applies the note (as a new note, or as an edit
of the note it came from) to a copy of that tab's old in-memory library,
validates the result, encrypts every record with that tab's old key, and writes
it under the old header, without reading or writing the database. A note whose
original note no longer exists in that copy, or whose collection no longer
exists, is filed as a new note at the top level. An invalid or empty note is
refused, and the recovery panel offers Keep editing so the editor is reachable
again; the note is never dropped silently.

### Import

Import is staged. The checks run in this order and stop at the first failure,
and nothing is written until the person confirms:

1. File size at most 32 MiB.
2. JSON structure, format name and version, no extra fields, base64 and byte
   lengths of the salt and every nonce and ciphertext, and an iteration count
   of exactly 600000. No key is derived before this passes.
3. Key derivation from the backup passphrase, unwrapping the data key, and
   opening the snapshot envelope. A wrong passphrase and any authentication
   failure give the same message and never produce a library.
4. At most 1,000 records, no duplicate IDs, every record in the header's vault,
   and every record decrypted and validated, then the whole tree (parents,
   cycles, depth).

The person sees the item count, may export the current library first, and then
confirms Replace. The backup's passphrase becomes the library's passphrase from
then on, and the theme is unchanged. Replacement requires an unlocked library
with no unsaved note. Commit is one transaction that clears the items, writes
the imported header and records, and increments generation and revision, after
checking that the generation and revision are still the ones that were
reviewed. Any mismatch or write error aborts with the old library intact, and a
changed library needs a new review. After success the old in-memory session is
cleared, the imported session is installed with the generation the repository
returned, and other tabs are notified with identifiers and revisions only. A tab
with an unsaved note keeps its old session and uses the recovery export.

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
change stored data. A session locks after thirty minutes without keyboard, pointer,
or touch activity, and after ten minutes with the tab hidden; secrets are
concealed as soon as the tab is hidden, and a tab that resumes past either
deadline locks before showing content. An unsaved note draft is sealed into a
draft-purpose envelope held in memory only, and is offered back only after
unlocking the same vault and generation. If sealing fails, the tab stays
concealed and offers Save or Discard instead of reporting Locked.

When another tab changes the stored vault, a tab without a dirty draft releases
its session. A tab with a dirty draft behaves by what changed. A header-only
change (same vault id and generation, for example a passphrase change) keeps the
session, because the data key is unchanged: the tab adopts the new header and
the draft carries on. A replacement (different vault id or generation) conceals
the library and shows a recovery panel with Export backup, Keep editing, and
Discard draft and reload. The old library then exists only in that tab's memory,
so the tab cannot lock the usual way. The inactivity and hidden deadlines still
run: once one passes, Export backup and Keep editing stay disabled until the
passphrase for that library is entered again (checked against the tab's
in-memory header; nothing is written). Discard never needs it. The same applies
if a deadline passes after Keep editing: the panel returns locked and the draft
is never dropped. Saving after Keep editing still meets the replaced-library
refusal.

## Offline cache

Scratch registers a static service worker so the app shell opens without a
network after one online visit. The worker precaches only build output: the
page, scripts, styles, bundled woff2 fonts, the manifest, and icons. It has no
runtime caching and no handler for other requests, so notes, vault records,
exported backups, imported files, and passphrases are never written to Cache
Storage. Library data stays only in IndexedDB as described above. An update
replaces the cached shell only after the person approves it, and the page then
reloads to the locked screen because keys never survive a reload.
