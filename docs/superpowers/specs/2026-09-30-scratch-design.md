# Scratch design brief

Date: September 30, 2026. Status: planning baseline. This document and the accompanying implementation plan are the deliverables; implementation is outside this assignment.

## 1. Purpose and agreed decisions

Scratch makes short pieces of written information quick to capture, easy to organize, and easy to retrieve in one place. The primary interface is a grid of large tiles. A collection tile opens another grid; a note tile opens its written content.

The user selected direction B, Color collections, from the [comparison sketch](assets/scratch-directions.png). The selected visual direction is the center column. The final design replaces the sketch's heading with **Scratch**, removes its purple accent, and adds a deliberate dark theme. The sketch communicates layout, not final colors or fonts.

Confirmed requirements:

- The product name and home heading are Scratch.
- Start with a web app usable on desktop and phone.
- Collections and notes are distinct tile types.
- Store actual API tokens alongside ordinary notes.
- Use the selected B layout with large, colored collection tiles.
- Support light and dark themes.
- Avoid a generic AI-product palette and typography.
- Store locally in each browser, with export and import.
- Keep the app simple and excellent at this focused task.
- Produce a detailed implementation plan; do not execute it or write product code.

## 2. Planning defaults

These are proposed defaults, not answers the user explicitly supplied. They make the plan concrete and are easy to review before any future implementation.

| Decision | Default | Reason |
| --- | --- | --- |
| Writing | Plain text, optional title, explicit Save | Fast capture with a clear persistence boundary |
| Nesting | Collections may contain collections and notes, at most eight collection levels | Enough structure while keeping mobile navigation manageable |
| Encryption | Encrypt all titles and content behind one local passphrase | Ordinary notes can also contain sensitive information; one storage path is simpler |
| Secret display | Explicit Secret note option; mask content by default | Supports tokens without guessing what every pasted string means |
| Session | Lock on reload, after ten minutes of inactivity, or after sixty seconds hidden | Protects stored tokens without an account system |
| Organization | Rename, change collection color, move using a picker, delete with confirmation | Works equally well with touch and keyboard |
| Ordering | Collections first, then notes; oldest creation first within each group | Stable positions do not jump while editing |
| Import | Restore a complete encrypted library, replacing the current library after confirmation | Predictable manual transfer without merge conflicts |
| Recovery | No passphrase recovery; a backup requires the passphrase used when exported | Avoids pretending encrypted data can be recovered without its key |
| Offline | Cache the static app after a successful online visit | Locally stored notes should remain usable without a network |

No autosave, drag and drop, arbitrary rich text, automatic token detection, or import merging in version one.

## 3. Scope and success criteria

The core loop is **capture a short note, put it in a collection, find and copy it later**. The default screen should make this obvious without instructions.

Version one includes an empty-library state, local passphrase setup/unlock, large tiles, nested collections, note creation/editing, collection creation/editing, moving and deleting items, global search, copying, theme selection, local locking, encrypted backup export/import, and static offline availability.

The app has no cloud backend, accounts, collaboration, AI features, attachments, databases disguised as notes, task boards, markdown rendering, tags, pinning, or recent-items sidebar. No analytics or remote font requests. Installing native mobile software is outside scope. The manifest and static cache may allow installation where the browser supports it, but this remains a web app.

Acceptance goals:

1. From an unlocked library, capture a note by choosing Add > Note, typing, and saving. A title is optional.
2. Scratch > API Tokens > OpenAI is navigable using tiles and browser Back/Forward.
3. Opening an ordinary note allows immediate reading, editing, and copying. Secret content requires an explicit reveal or copy action.
4. Notes survive reload and can be moved to another browser through an encrypted backup.
5. Light and dark themes are equally complete; no violet gradients, glowing panels, or large marketing headings.
6. At 360 px width, all primary actions remain visible and at least 44 px tall. At 320 px and 200% zoom there is no horizontal page scrolling.
7. A failed save never displays Saved or closes an unsaved editor.
8. Wrong passphrases, malformed imports, and stale-tab writes do not overwrite saved data.

## 4. Screens and interaction contract

### Home and collection screens

The header contains the Scratch wordmark, Search, Add, and an icon button named Settings. On mobile, the wordmark and Add/Settings occupy the first row and Search occupies a full-width second row. Inside a collection, display its name and breadcrumbs beneath the header. Use a back control and shortened ancestry on narrow screens, with the full ancestor list available as a menu.

Use one grid column below 600 px, two from 600 to 959 px, and three at 960 px and above. Constrain the content to 1120 px. Mobile padding is 16 px, tablet 24 px, desktop 32 px. Tile gaps are 16 px. Tiles are at least 144 px tall on desktop and 120 px on mobile, with a 14 px radius and 20 px internal padding. No sidebar.

Collection tiles use one of four named tints, a folder icon, title, and immediate child count. Count is formatted as 1 item or N items, including both collections and notes. Notes use a neutral surface, a note icon, derived or explicit title, and a two-line preview. Secret tiles use a lock icon and eight fixed masking dots; their body and body-derived title never appear in previews. Duplicate titles are allowed because item identity is a UUID.

The tile's main area is a semantic navigation control. Copy and overflow are separate sibling controls, never buttons nested inside a link. Overflow contains Edit, Move, and Delete. Copy appears on note tiles; collection tiles do not copy a whole collection.

An empty home says "A place for the little things." with Add note and Add collection. Empty collections say "Nothing here yet." Search results say "No matches." No seeded demo notes are inserted into a user's library.

### Note editor

Desktop: a centered dialog, maximum 640 px wide. Mobile: a full-screen sheet with a sticky action row, safe-area padding, and a scrollable body that remains usable with the keyboard open. Use one shared editor component with responsive presentation.

Add opens a small menu with Note and Collection. Note opens a body-first editor in the current collection, or root from home/global search. The optional title field is initially collapsed behind Add title. Save and Cancel are explicit. Ctrl/Cmd+Enter saves; Escape closes only if clean, otherwise asks whether to keep editing or discard. Browser navigation with a dirty editor uses the same guard; tab close/reload uses the browser's available beforeunload behavior. No claim that browsers can guarantee saving unsaved text during process termination.

An ordinary note without a title displays its first nonblank line, truncated to 60 grapheme clusters. Its stored title remains null, so later edits update its derived title. Preserve the body exactly, including spaces and line breaks; use trimming only to determine whether it is empty. A Secret note requires an explicit title, so a token never becomes its title. Both types use plain text with no HTML execution and no automatic remote link previews.

Limits: titles up to 80 grapheme clusters and 1,024 UTF-8 bytes; bodies up to 10,000 UTF-8 bytes. The title byte limit prevents pathological combining-mark input from bypassing the visible-character limit. Empty or whitespace-only bodies cannot be saved. Labels and validation messages explain the actual limit. Composition events from IME input must not trigger premature keyboard saves.

Secret notes are created with a clearly labeled Secret toggle. Reading starts masked; Reveal lasts at most 30 seconds and ends immediately on close, blur to a hidden document, or lock. Editing an existing secret requires Edit secret and remains an explicit action. Copy uses the exact body and announces Copied only after clipboard success. If permission is denied, ordinary notes offer Select text; secret notes offer Reveal to copy manually. Do not pretend a web page can reliably clear the operating system clipboard later.

### Collections and organization

Collection creation requires a nonblank title and offers Sage, Clay, Ochre, and Slate color choices. Default color is Sage. Color is a supporting cue; title and icon carry meaning. Colors do not imply secret protection.

Move opens a simple list of eligible destination collections with a root destination named Scratch. Exclude the moved collection and all its descendants. Prevent depth above eight, absent parents, note parents, and cycles. Collection deletion shows the total number of descendants and explicitly confirms deleting them. Deleting a note also requires confirmation. Deletion is permanent in version one; the confirmation says so. No trash subsystem or temporary undo promise.

### Search

Search is global, performed in unlocked memory, with a 150 ms debounce. Match collection titles, note titles, and ordinary note bodies using case-insensitive substring matching; normalize the search index to NFC without changing stored text. Exclude secret bodies from the index, even while revealed. A secret may be found by its explicit title. Each result displays the parent path. Clicking a result opens the note in its collection or navigates to the collection. Clearing search returns to the preceding collection. No query is placed in a URL or storage.

### Settings, passphrase, and backup

Settings contains Theme (System, Light, Dark), Lock, Change passphrase, Export backup, Import backup, and a concise storage note: "Stored in this browser. Export a backup to keep a copy."

First use offers Create Scratch or Import backup. Creating a library asks for a passphrase and confirmation, with a minimum of 12 Unicode code points and maximum of 256 UTF-8 bytes. Accept spaces and paste, do not trim or normalize the passphrase, and explain that it cannot be recovered. Unlock uses that local passphrase, with no signup or email step.

Manual lock with dirty text offers Save and lock, Discard and lock, or Cancel; a failed save leaves the editor open. Automatic lock conceals the editor, encrypts any dirty draft into a session-memory envelope, then releases the key and plaintext. Return to the draft only after the same vault is unlocked; refresh loses that unsaved draft. If sealing a draft fails, conceal it and show a lock-error recovery state with Save or Discard rather than falsely claiming a completed lock. When the document becomes hidden, conceal secrets immediately and start the sixty-second lock timer; check elapsed time on resume because background timers may be throttled. A complete reload always begins locked. Lock applies to the current tab; another unlocked tab has its own session and timer.

Passphrase changes rewrap the existing data key with a new random salt and nonce; they do not reencrypt every note. Require the current passphrase and new confirmation. Already exported backups retain their old passphrase. Replacement imports require unlocking the existing library, choosing a file, providing the backup's passphrase, reviewing the item count, and confirming Replace. Offer Export current backup before Replace. An initial import is allowed from the setup screen. Imported passphrase becomes the library's passphrase.

## 5. Visual contract

Use Source Sans 3 for controls, notes, and tile text. Use Source Serif 4 semibold only for the Scratch wordmark, 30 px desktop and 26 px mobile. Self-host the fonts and retain their licenses. Body text is 16 px with 1.5 line height, tile titles 20 px/1.25 at weight 600, and supporting text 14 px/1.4. Note content is never forced into a decorative font. Use the system monospace stack only when revealing a secret.

| Token | Light | Dark |
| --- | --- | --- |
| Page background | #F7F4EE | #191B18 |
| Neutral surface | #FFFDF8 | #232620 |
| Primary text | #282923 | #EFECE3 |
| Muted text | #626358 | #B6B9AB |
| Decorative border | #D9D6CC | #454A40 |
| Primary action fill | #626C39 | #BBC697 |
| Primary action text | #FFFDF8 | #202419 |
| Sage collection | #E8ECDD | #30382A |
| Clay collection | #F1DED2 | #3F3028 |
| Ochre collection | #F2E7C7 | #3B3524 |
| Slate collection | #DFE8EA | #293438 |
| Focus ring | #626C39 | #BBC697 |

Use primary and muted text tokens on all collection tints; no white text on pale colored cards. Borders are decorative, not the only indication of an input or focus. Verify normal text at 4.5:1, large text at 3:1, and meaningful control boundaries/focus at 3:1 against adjacent surfaces. Correct a failing semantic pair rather than skipping contrast verification.

Planning verification: numerical contrast checks of the selected primary/muted/action text pairs and focus rings passed their applicable thresholds. The lowest checked normal-text pair is light muted text on Clay at 4.68:1; the lowest checked focus pair is the light focus ring on Clay at 4.33:1, above its 3:1 requirement. These are palette checks, not an accessibility audit of an implemented app.

The theme follows the operating system on first use. Persist only System/Light/Dark in localStorage. Resolve it before first paint and respond to system changes only while System is selected. Follow reduced motion. Limit hover to a border change and a subtle surface adjustment with a 120 ms transition; do not move the tile. No purple/blue gradients, neon, glass panels, oversized geometric headings, or floating decoration.

## 6. Data, encryption, and storage contract

Use a static React/TypeScript app built with Vite, plain CSS with semantic variables, Dexie for IndexedDB, browser Web Crypto, Vitest/Testing Library, and Playwright. There is no API, server database, or remotely persisted user content. Package versions are pinned in the lockfile when implementation begins. Use Node 22.12 or newer supported even-numbered LTS; recheck dependency requirements at that time.

The database is scratch-v1, with vault, items, and meta stores. Exactly one vault is active. Each item has UUID id, vaultId, nullable parentId, kind (collection or note), integer version, creation/update timestamps, and an encrypted payload. Collections carry title/color in the payload. Notes carry nullable title/body/isSecret. Parent relationships, kind, IDs, version, and timestamps are unencrypted structural metadata; title, body, color, and secrecy flag are encrypted. Encryption does not hide item count or the collection tree. No plaintext search index or persisted editor draft.

A VaultHeader has formatVersion 1, vaultId, a 16-byte random salt, the PBKDF2-SHA-256 iteration count 600,000, and an AES-GCM wrapped 32-byte random data key with a fresh 12-byte nonce and 128-bit authentication tag. Derive the wrapping key from the passphrase; unwrap and import the data key as nonextractable. Keep keys only in memory. Use fresh cryptographic random nonces for every payload encryption and rewrap. Associated data authenticates the format, vault ID, operation purpose, and item metadata in a documented canonical order. Authenticate structural changes by reencrypting each changed item. Never reuse a nonce.

On save, encrypt before opening the IndexedDB transaction. Compare the library generation and item versions inside the transaction before committing. Tree-changing operations also compare the snapshot revision. Increment revision on every write. Imports change the generation. Handle stale writes as conflicts, keeping the dirty draft visible until the user chooses a recovery action; do not silently use last-write-wins. Cross-tab notifications contain only IDs/revisions/generation, never plaintext or keys.

Read/decrypt and validate the full library after unlock. Reject corrupted records without silently replacing them or resetting the database. The maximum supported library is 1,000 items and eight collection levels; report limits before saving. At this bound, an unlocked in-memory search index and full graph validation are appropriate. A storage failure is surfaced before any success state.

Encryption protects content stored at rest and in exported files. An unlocked web page, a compromised same-origin script, and deliberate clipboard copying still expose usable plaintext. Avoid third-party scripts, text telemetry, and content logging. JavaScript memory cannot be guaranteed securely erased; release references and clear UI/state rather than claim zeroization.

Browser storage belongs to the exact origin and can be cleared by the user or evicted. Ask for persistent storage once after the first successful save; denial is nonfatal. Avoid moving the deployment to a new origin without directing the user to export first. If IndexedDB is unavailable, show a storage-unavailable screen with Retry; do not fall back silently to temporary plaintext storage.

## 7. Backup format and import behavior

A backup is a UTF-8 JSON .scratch file named scratch-backup-YYYY-MM-DD-HHmm.scratch, using local date/time. Outer fields are format "scratch-backup", formatVersion 1, exportedAt, VaultHeader, and one authenticated AES-GCM snapshot envelope. The envelope contains the vault ID and a full list of stored encrypted records. It authenticates the complete set, so missing/reordered/tampered records cannot be mistaken for a complete exported library. The complete backup remains encrypted; theme preference and search queries are not included.

Reject files over 32 MiB, unknown format versions, extra unsupported algorithm parameters, excessive item counts, malformed base64, duplicate IDs, invalid timestamps, invalid kinds, missing parents, cycles, excessive depth, mismatched vault IDs, overlong text, invalid colors, empty note bodies, and secrets without titles. This permits a maximum-size valid library plus nested encrypted/base64 overhead. Complete decryption and validation before showing the replacement confirmation. Treat wrong passphrase and authentication failures as "Could not unlock this backup. Check the passphrase and file." Neither condition changes the database.

Snapshot export reads header and records in one readonly transaction, then encrypts outside it. Import prepares all validated data before one readwrite transaction that replaces vault/items and increments generation/revision. If the transaction fails, the old library remains intact. Keep the current theme. There is no merge or automatic synchronization between browser copies.

## 8. Offline, accessibility, and quality

Precache only the app shell, built assets, icons, and bundled fonts. Do not cache exports, plaintext, secret values, or database data in the service worker. First visit needs a network. After the service worker is installed and controlling the page, reopening the app offline works. New service workers wait while a user is working; offer Update ready and activate only after the user saves/discards any draft and agrees to reload.

Keyboard users can navigate tiles, use Add, search, edit, move, copy, and change theme. Dialogs trap focus, restore focus on close, and have names. Every icon button has an accessible name. Touch targets are at least 44 px. Announcements cover save, copy, errors, and search result counts without announcing secret content. Include visible focus and reduced-motion support. Honor font zoom; do not encode meaning by color alone.

Support the current and previous major stable releases at implementation time of Chrome, Edge, Firefox, Safari, iOS Safari, and Android Chrome. Require IndexedDB, Web Crypto, and Intl.Segmenter; a browser without a required API gets an explicit unsupported-browser screen rather than incorrect text validation or temporary plaintext storage.

Performance targets for future verification: warm navigation under 100 ms for 1,000 short items, search results within 250 ms after the debounce, and no network request required for note operations after loading. Target initial JavaScript at or below 200 KiB gzip; fonts are measured separately. These are targets, not measurements from this planning session. Passphrase derivation is intentionally expensive; show Unlocking and measure on a real phone rather than reducing the work factor silently.

## 9. Official references checked for this plan

These explain platform/library behavior. The product defaults above are design choices.

- [Vite getting started](https://vite.dev/guide/): runtime prerequisite and React/TypeScript scaffolding.
- [Dexie transaction guidance](https://dexie.org/docs/Dexie/Dexie.transaction%28%29): avoid unrelated async work inside live database transactions.
- [MDN key derivation](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey) and [encryption](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt): Web Crypto primitives and secure-context requirement.
- [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html): the 600,000 PBKDF2-HMAC-SHA-256 work factor informs the selected wrapping-key derivation default; this is a key derivation design, not a claim that the app stores password hashes or is security certified.
- [MDN clipboard](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText): secure-context clipboard writes may fail and must be handled.
- [MDN storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria): local storage persistence is not a substitute for backups.
- [Fontsource installation](https://fontsource.org/docs/getting-started/install), [Source Sans 3](https://fontsource.org/fonts/source-sans-3), and [Source Serif 4](https://fontsource.org/fonts/source-serif-4): bundled font choices.
- [Vitest guide](https://vitest.dev/guide/) and [Playwright assertions](https://playwright.dev/docs/test-assertions): planned verification tools.
- [Vite PWA prompt update behavior](https://vite-pwa-org.netlify.app/guide/prompt-for-update): planned static caching and user-controlled update activation.

## 10. Authority and completion boundary

The user's chosen mockup, explicit local-storage answer, and naming/theme/simplicity requirements take precedence over process defaults. The planning defaults are recorded for review rather than disguised as confirmed choices. No product files, packages, live project, or deployment are created in this assignment. The accompanying plan may describe future code and commands, but contains no executable implementation snippets.
