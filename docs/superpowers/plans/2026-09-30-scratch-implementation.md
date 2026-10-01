# Scratch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task only after a separate user request authorizes execution. Steps use checkbox syntax for tracking. This assignment ends with the plan; no execution method is being selected now. Future workers must follow the user's model and reasoning-effort limits.

**Goal:** Build Scratch, a focused web app for capturing, organizing, finding, and copying short notes through large collection and note tiles on desktop and mobile.

**Architecture:** A static React app owns a single encrypted library in each browser's IndexedDB. A small repository handles atomic writes and hierarchy rules, an in-memory unlocked session supplies search and views, and browser Web Crypto protects note content and portable backups. The app has no account or backend; a static service worker makes the shell available offline after initial loading.

**Tech Stack:** React, TypeScript, Vite, plain CSS, Dexie, Web Crypto, Source Sans 3, Source Serif 4, Vitest, Testing Library, fake-indexeddb, Playwright, and vite-plugin-pwa using its static precache/update behavior. Do not introduce a state framework, CSS framework, editor framework, or hosted database.

**Spec:** [Scratch design brief](../specs/2026-09-30-scratch-design.md). Read it alongside this plan. The reference image is [direction B in the center column](../specs/assets/scratch-directions.png); the brief's color and typography contract overrides the draft image.

## Global Constraints

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
- Use Node 22.12 or newer supported even-numbered LTS; recheck dependency requirements at implementation time and pin resolved package versions with package-lock.json.
- Use no em dashes in project prose or UI copy.
- Never select Astra for a subagent unless the user specifically requests it. Never use Opus subagents unless the user specifically requests it. Run every subagent (implementation, research, reviews, fixes, final review) on Sonnet 5.5 at medium reasoning effort or lower; use high reasoning only for implementation plans/specifications.
- This is a greenfield workspace, inspected as empty and not a Git repository. The only files supplied by this planning assignment are this plan, its design brief, and the reference image. All product/configuration/test files listed below are future work.
- To honor the user's no-code request, this plan specifies exact files, interfaces, behavior, commands, and Given/When/Then tests in prose. It intentionally contains no executable product or test snippets.

## Review Focus

1. An interrupted write, exhausted storage, or unavailable IndexedDB must leave saved data intact and keep an unsaved editor open. Test in Tasks 3 and 6.
2. A token pasted into a Secret note must never become a title, preview, persisted plaintext, search match, URL, or misleading success announcement. Test in Tasks 2, 6, and 8.
3. A malformed, truncated, oversized, wrong-passphrase, or structurally invalid backup must not replace the current library. Test in Task 9.
4. A stale editor in a second tab must not overwrite newer edits or a replaced library. Test in Tasks 3, 6, and 9.
5. A narrow phone, open keyboard, long Unicode title, IME input, or keyboard-only user must retain access to the core capture/navigation actions. Test in Tasks 1, 5, 6, and 11.

---

## A. Product boundary and order

Implement one product, not separate notes and password-manager subsystems. Encryption is the storage boundary, while Secret is a display/search setting on a note. A user should experience Scratch as a small, dependable notebook.

The delivery order is:

| Task | Independently reviewable result | Depends on |
| --- | --- | --- |
| 1 | Responsive Scratch shell with working theme selection | None |
| 2 | Defined item model, validators, and authenticated crypto primitives | None |
| 3 | Atomic encrypted local repository | 2 |
| 4 | Create/unlock/lock/change-passphrase session | 1, 2, 3 |
| 5 | Large tiles and collection navigation | 1, 3, 4 |
| 6 | Fast note creation/editing and explicit persistence | 3, 4, 5 |
| 7 | Collection creation/editing, move, delete | 3, 5, 6 |
| 8 | Search and exact clipboard copying | 4, 5, 6 |
| 9 | Encrypted export and safe replacement import | 2, 3, 4, 6 |
| 10 | Offline shell and controlled updates | 1, 4, 6, 9 |
| 11 | Integrated desktop/mobile acceptance and handoff | All |

Default to sequential execution in a later authorized session. Some foundations could be developed independently, but that is not authorization to spawn agents now.

## B. Future file map

Paths in this section are relative to the repository root C:/Users/misha/scratch. Keep related behaviors near each other; do not place all logic inside App.tsx.

| Future path | Responsibility |
| --- | --- |
| package.json, package-lock.json | Pinned dependencies and named scripts |
| index.html | Scratch page title, pre-paint theme bootstrap, app root |
| vite.config.ts, tsconfig.json, tsconfig.app.json, tsconfig.node.json | Build, strict TypeScript, and later PWA configuration |
| vitest.config.ts, playwright.config.ts | Unit/component and browser test configuration |
| eslint.config.js | TypeScript/React lint rules; no content logging allowances |
| src/main.tsx, src/app/App.tsx | Entrypoint, providers, screen composition |
| src/app/navigation.ts | Hash navigation, browser history, safe route parsing |
| src/app/useNavigation.ts | React adapter for navigation events and dirty-editor guards |
| src/app/SettingsDialog.tsx | Theme, lock, passphrase, backup controls |
| src/app/global.css, src/app/tokens.css | Baseline layout, theme palette, focus, typography |
| src/features/theme/theme.ts, ThemeProvider.tsx | Preference resolution, persistence, OS changes |
| src/components/AppHeader.tsx, TileGrid.tsx, Dialog.tsx, ToastRegion.tsx, EmptyState.tsx | Small semantic shared components |
| src/features/library/types.ts, validation.ts, hierarchy.ts, display.ts | Shared item contract, boundaries, tree operations, derived labels |
| src/features/library/database.ts, repository.ts, changes.ts | Encrypted Dexie storage, mutations, metadata-only cross-tab notifications |
| src/features/library/LibraryProvider.tsx | Unlocked snapshot, refresh, repository result handling |
| src/features/vault/types.ts, crypto.ts, session.ts | Encrypted envelopes, key operations, lock lifecycle |
| src/features/vault/VaultProvider.tsx, VaultScreen.tsx, ChangePassphraseDialog.tsx | Session integration and minimal vault screens |
| src/features/collections/CollectionView.tsx, CollectionTile.tsx, CollectionEditor.tsx, MoveDialog.tsx, DeleteDialog.tsx | Collection grid and organization |
| src/features/notes/NoteTile.tsx, NoteEditor.tsx, useNoteDraft.ts | Short-note display, composing, dirty state |
| src/features/search/search.ts, SearchResults.tsx, useSearch.ts | Ephemeral unlocked index and results |
| src/features/clipboard/copy.ts | Clipboard success/error boundary |
| src/features/backup/types.ts, backup.ts, BackupDialog.tsx | Portable authenticated snapshot and import/export UI |
| src/features/offline/register.ts, UpdateNotice.tsx | Static offline registration and save-safe updates |
| public/icons/scratch-192.png, scratch-512.png, scratch-maskable-512.png | Plain product mark for installation; no remote images |
| tests/setup.ts, tests/fixtures/library.ts | Test environment and synthetic data |
| tests/theme.test.tsx, library.validation.test.ts, vault.crypto.test.ts | Theme, model, and crypto behavior |
| tests/library.repository.test.ts, vault.session.test.tsx, navigation.test.tsx | Storage, vault lifecycle, navigation |
| tests/note.editor.test.tsx, collection.actions.test.tsx | Capture and organization |
| tests/search.test.ts, clipboard.test.ts, backup.test.ts | Finding, copying, and transfers |
| tests/e2e/scratch.spec.ts, secrets.spec.ts, transfers.spec.ts, offline.spec.ts, accessibility.spec.ts | Browser acceptance |
| README.md, docs/storage-format.md, docs/verification.md | Running the app, recovery/storage contract, measured acceptance results |

Generated service-worker/build files belong in dist and are not source files. Keep font licenses with the bundled dependency notices; include attribution in README. The service worker caches bundled fonts, not external font URLs.

## C. Shared contracts

Specify these contracts in the named type files before later tasks rely on them. The following are descriptions of future interfaces, not executable declarations.

### Values and limits

- ItemId, VaultId, and Generation are UUID strings. Root is represented by parentId null, never by a fake root row.
- ItemKind is collection or note. CollectionColor is sage, clay, ochre, or slate.
- ThemePreference is system, light, or dark; ResolvedTheme is light or dark.
- LibraryItem contains id, vaultId, parentId, kind, version, createdAt, updatedAt, and its typed decrypted payload. Timestamps are epoch milliseconds, finite nonnegative integers; createdAt cannot exceed updatedAt.
- Collection payload: required title and color. Note payload: title string or null, exact body string, and isSecret boolean. Reject fields inconsistent with kind.
- StoredItem contains the same metadata as LibraryItem but replaces payload with CipherEnvelope. CipherEnvelope contains base64 nonce and base64 ciphertext including the AES-GCM tag.
- VaultHeader is the brief's formatVersion/vaultId/salt/iterations/wrapped-key record. MetaRecord contains revision and generation. LibrarySnapshot contains header, metadata, and a validated list of LibraryItem values.
- CreatedVault contains header and an in-memory nonextractable dataKey before persistence. VaultSession contains header, generation, and the nonextractable dataKey after persistence/unlock. Neither is serializable to persistent state.
- NoteInput contains parentId, nullable title, body, and isSecret. CollectionInput contains parentId, title, and color.
- MutationContext contains generation and expectedRevision from the current snapshot. Update/delete/move also carry expectedVersion for the target. A successful mutation returns a fresh snapshot.
- MutationResult is a discriminated success or failure result. Failure codes are validation, conflict, vault-changed, quota, unavailable, and corrupt. Failures have a safe user message without including note content.
- App limits: 1,000 items; collection depth eight; title 80 grapheme clusters and 1,024 UTF-8 bytes; body 10,000 UTF-8 bytes; passphrase 12 Unicode code points minimum and 256 UTF-8 bytes maximum; import file 32 MiB. Validate bytes with TextEncoder and title clusters with Intl.Segmenter. Require the APIs listed in the brief rather than silently substituting incorrect Unicode counting.

### Crypto entry points

- createVault(passphrase: string) asynchronously returns CreatedVault with a fresh data key. After initializeLibrary succeeds, combine its generation with CreatedVault to form VaultSession; no session with an absent generation exists.
- unlockVault(header: VaultHeader, passphrase: string, generation: Generation) asynchronously returns VaultSession or an unlock failure.
- encryptItem(session: VaultSession, item: LibraryItem) asynchronously returns StoredItem; decryptItem(session: VaultSession, item: StoredItem) returns a validated LibraryItem or corrupt failure.
- sealEnvelope(session: VaultSession, purpose: backup or draft, plaintext: Uint8Array) and openEnvelope with the same purpose return encrypted and decrypted bytes. Purposes are authenticated to prevent substituting a draft for a backup.
- rewrapVault(session: VaultSession, currentPassphrase: string, newPassphrase: string) returns a new header only after validating the current passphrase.
- All crypto functions reject unsupported parameter values before expensive derivation. The only format-one KDF count accepted is 600,000.

### Repository entry points

- initializeLibrary(header: VaultHeader) stores an empty library and returns its initial revision/generation; it fails if a library already exists.
- readHeader() returns header and metadata or no-library. loadLibrary(session: VaultSession) returns LibrarySnapshot only after decrypting and validating the entire library.
- createNote(session, context, NoteInput), createCollection(session, context, CollectionInput), updateNote(session, context, id, expectedVersion, NoteInput), and updateCollection(session, context, id, expectedVersion, CollectionInput) return asynchronous MutationResult.
- moveItem(session, context, id, expectedVersion, destinationParentId) and deleteItem(session, context, id, expectedVersion) return asynchronous MutationResult. Delete validates the subtree in the same committed snapshot.
- changePassphrase(session, context, newHeader) atomically replaces only the vault header and increments revision. Header-change notifications ask other tabs to lock/reload; a tab with a dirty draft must receive the draft recovery choice before discarding it.
- readStoredSnapshot() returns header, metadata, and stored records from one readonly transaction. replaceLibrary(preparedBackup, expectedGeneration: Generation or null, expectedRevision: number or null) commits only fully validated data and changes generation. Both expected values are null only for initial import, and the transaction then verifies no library exists.
- Repository functions never accept passphrases, log content, or persist decrypted payloads. They consume a VaultSession and delegate cryptography before transactions.

### UI and navigation entry points

- useVault exposes state (setup, locked, unlocking, unlocked, lock-error), session when unlocked, create, unlock, requestLock, automaticLock, and changePassphrase.
- useLibrary exposes snapshot, refresh, runMutation, and clearUnlockedState. Failure results preserve drafts and return accessible messages.
- useTheme exposes preference, resolvedTheme, and setPreference. The bootstrap and provider share identical precedence rules.
- AppRoute contains collectionId (UUID or null) and optional noteId. Home is #/; a collection is #/c/{id}; a note is #/c/{parent-id-or-root}/n/{id}. All IDs are validated; no title, body, or search term enters the hash.
- useNavigation exposes route, openCollection, openNote, closeNote, navigateBack, and a dirty-editor guard. A malformed/deleted route falls back to the nearest existing collection or home with a brief message.
- NoteEditor consumes initial NoteInput, existing item identity/version if editing, onSave, and onCancel; it reports draft dirtiness to its parent. onSave resolves to MutationResult.
- copyNote(body: string) returns copied, denied, or unavailable. buildSearchIndex(items) returns ephemeral entries; searchItems(index, query) returns matching IDs and parent paths, never secret bodies.
- exportBackup(session) returns a Blob and suggested filename. prepareImport(file, backupPassphrase) returns a PreparedBackup containing the verified header, stored records, decrypted preview count, and source session. The staging source session gets a temporary random generation; after replacement the installed session uses the generation actually returned by the repository. Commit occurs only after confirmation through replaceLibrary.

## Task 1: Establish the responsive shell and both themes

**Files:** Create package/configuration/entry files; src/app/App.tsx, global.css, tokens.css; theme files; AppHeader, Dialog, ToastRegion, EmptyState, TileGrid; tests/setup.ts and theme.test.tsx. Create README.md with run commands. Do not install dependencies during this planning assignment.

**Interfaces:** Produces useTheme, AppHeader, Dialog, ToastRegion, TileGrid, and a placeholder-free empty shell named Scratch. Later features plug into the shell's content slot. Dialog consumes title, children, close request, and dirty-close permission; focus handling is shared rather than duplicated.

- [ ] **Step 1:** At execution time, inspect the workspace and instructions again. Initialize Git only if still absent and a future execution request covers repository setup. Scaffold the Vite React/TypeScript project in this root while preserving docs. Select package versions from current official requirements and write the lockfile.
- [ ] **Step 2:** Define scripts dev, build, typecheck, lint, test, test:watch, and test:e2e. test invokes vitest run; typecheck checks both app and build/test TypeScript configurations; test:e2e invokes playwright test. Set strict TypeScript and typed errors. Add only the libraries needed by the file map, with test libraries as dev dependencies.
- [ ] **Step 3:** Add the theme cases below before provider implementation. Run npm run test -- tests/theme.test.tsx and confirm the missing theme behavior fails rather than an unrelated environment error.
- [ ] **Step 4:** Implement tokens exactly from the brief, bundled fonts, baseline typography, theme bootstrap, System/Light/Dark settings, and the responsive header/grid. Read only the theme preference from localStorage; catch storage access failures and default to system. Add HTML title Scratch and language en.
- [ ] **Step 5:** Implement semantic shared dialog and toast behavior, visible focus, reduced motion, and empty home actions. Leave empty actions clearly inert only within a development test fixture; the delivered app later wires them through the real Add menu. Do not ship an artificial demonstration library.
- [ ] **Step 6:** Run npm run test -- tests/theme.test.tsx, npm run typecheck, npm run lint, and npm run build. Check 360 px, 768 px, and 1280 px with both themes. Verify all palette text/action/focus pairs numerically before accepting the CSS.
- [ ] **Step 7:** Commit this future deliverable with message feat: establish Scratch shell and themes. Record package versions and measured palette corrections in README, if any.

| Test | Given / When | Required assertion |
| --- | --- | --- |
| Default theme | No preference and a dark OS | Dark resolves before the application first paints |
| Explicit choice | Light preference and a dark OS | Light wins and survives reload |
| OS change | System selected, OS toggles | Theme updates; explicit Light/Dark does not |
| Storage unavailable | localStorage throws | Shell still renders using system preference |
| Dialog keyboard | Open a named dialog, tab around, close | Focus stays inside and returns to trigger |
| Narrow layout | 360 px and 200% text zoom | Add and Settings remain reachable; page does not overflow |

## Task 2: Define the item model and authenticated encryption

**Files:** Create library/types.ts, validation.ts, hierarchy.ts, display.ts; vault/types.ts and crypto.ts; tests/fixtures/library.ts, library.validation.test.ts, vault.crypto.test.ts; docs/storage-format.md.

**Interfaces:** Produces all shared values, validation rules, display label functions, createVault/unlockVault, item encryption/decryption, purpose-bound envelopes, and rewrapVault. hierarchy exports validateTree(items), descendantsOf(items, id), and collectionDepth(items, parentId).

- [ ] **Step 1:** Write deterministic synthetic fixtures: root collection API Tokens, child secret note OpenAI with body fixture-secret-DO-NOT-USE, ordinary note with multiline text, nested collections, and two items with the same title. Fixtures use no real credentials.
- [ ] **Step 2:** Specify the model and crypto cases below in the named tests. Run npm run test -- tests/library.validation.test.ts tests/vault.crypto.test.ts. Use the real Web Crypto implementation in a supported Node runtime for crypto tests; do not replace encryption with a mock that always succeeds.
- [ ] **Step 3:** Implement strict structural and payload validation, parent/cycle/depth checks, explicit title derivation, and stable sorting with collections first, then createdAt ascending, then ID ascending. A secret title may never be derived from body. Enforce byte/grapheme limits without mutating saved body text. Use a monotonic updatedAt value at least as large as the old timestamp and createdAt, even if the device clock moves backwards.
- [ ] **Step 4:** Implement wrapping-key derivation, random data-key creation, authenticated payload encryption, and nonextractable session keys. Item associated data is the UTF-8 encoding of a canonical JSON array in this order: scratch-item, format version 1, vaultId, id, parentId, kind, version, createdAt, updatedAt. Document this exact order.
- [ ] **Step 5:** Define wrapping associated data in this order: scratch-wrap, version 1, vaultId, salt base64, iterations. Envelope associated data is scratch-envelope, version 1, vaultId, purpose. Use AES-GCM 256-bit keys, 12-byte fresh nonce, and 128-bit tag throughout. Validate salt/nonce/data-key lengths and base64 before calls. Do not retain raw key bytes after importing/wrapping them.
- [ ] **Step 6:** Implement rewrap using a new salt/nonce and the existing data key. Because the active key is nonextractable, validate/unwrap the old wrapper to raw key bytes using the current passphrase, rewrap those bytes under the new passphrase, and promptly release the temporary bytes. No attempt to export a nonextractable CryptoKey is allowed.
- [ ] **Step 7:** Run the focused tests, typecheck, and lint. Document the exact storage/backup format and the distinction between at-rest protection and an unlocked webpage. Commit feat: define encrypted Scratch library model.

| Test | Given / When | Required assertion |
| --- | --- | --- |
| Round trip | Encrypt/decrypt multiline Unicode note | Exact title/body/isSecret survive |
| Randomized encryption | Encrypt same item twice | Nonces/ciphertexts differ; both decrypt correctly |
| Wrong passphrase | Unlock with another phrase | Controlled failure; no new empty vault |
| Tampering | Flip ciphertext bit or change parent/kind/version | Authentication fails, with no plaintext result |
| Purpose mismatch | Open backup envelope as draft | Decryption fails |
| Secret title | Secret note has null/blank title | Validation fails; fixture token is not used as title |
| Byte boundary | Body at 10,000 UTF-8 bytes, then over | Boundary passes, overflow fails without truncation |
| Title abuse | One visible cluster with thousands of combining marks | UTF-8 title limit rejects it without hanging or creating an oversized backup |
| Graph boundary | Missing parent, note parent, cycle, level nine | Each rejects; eight levels pass |
| Rewrap | Change phrase using old phrase | Existing records still decrypt with new phrase; old wrapper remains valid only for old backup |
| KDF abuse | Header requests enormous/unknown iterations | Rejected before expensive derivation |

## Task 3: Build the atomic encrypted local repository

**Files:** Create database.ts, repository.ts, changes.ts, LibraryProvider.tsx; tests/library.repository.test.ts. Modify library/types.ts only if an already specified result requires a declaration.

**Interfaces:** Produces the repository entry points and useLibrary. Database tables use id for item key and indexes on parentId, vaultId, and kind; meta/header have fixed keys. The provider owns the decrypted snapshot only while unlocked.

- [ ] **Step 1:** Add a fake-indexeddb-backed test database isolated per test. Write the repository cases below and run npm run test -- tests/library.repository.test.ts to see missing behaviors fail.
- [ ] **Step 2:** Implement database initialization/opening and safe unavailable/corrupt error mapping. Read metadata/header without decrypting to decide setup versus locked. Do not automatically clear a database that cannot be opened or validated.
- [ ] **Step 3:** Implement load and the create/update methods. Prepare validated/encrypted records before transactions. In each write transaction, compare generation, revision, and target version as applicable, update records, then increment revision. No Web Crypto, fetch, timer, or clipboard wait occurs inside a Dexie transaction.
- [ ] **Step 4:** Implement move/delete as transactions over a validated snapshot. Reencrypt changed metadata for moves; collection deletion removes exactly the confirmed subtree if the snapshot revision still matches. A concurrent change returns conflict rather than deleting newly added unseen descendants.
- [ ] **Step 5:** Implement readStoredSnapshot, header changes, and replacement transactions. Replacement compares expected generation/revision, writes a fresh generation, and rolls back every change on failure. Initial import is allowed only if no vault appeared meanwhile.
- [ ] **Step 6:** Publish metadata-only change notifications after commit using BroadcastChannel when available; otherwise refresh on window focus. A receiving unlocked tab reloads clean state. Dirty editors preserve their input and show a conflict/refresh choice instead of applying remote data over them. Notifications never carry content, queries, keys, or passphrases.
- [ ] **Step 7:** Request navigator.storage.persist after the first successful save when available. A denial leaves normal behavior intact. Quota/unavailable errors must be distinguishable from validation failures. Run focused tests, typecheck, and lint, then commit feat: persist encrypted notes atomically.

| Test | Given / When | Required assertion |
| --- | --- | --- |
| Persistence | Create/update then close and reopen database | Correct encrypted data survives reload |
| Plaintext absence | Save fixture secret and ordinary body | Raw IndexedDB records contain neither body nor title |
| Failed write | Inject transaction failure after first mutation | All old records/header/revision remain unchanged |
| Quota | Simulated quota error during write | Failure code quota; no success snapshot or partial write |
| Cross-tab edit | Two snapshots, first writes, second writes stale version | Second returns conflict and stored first edit survives |
| Replaced vault | Old generation writes after import | vault-changed failure, no records overwritten |
| Tree concurrency | Confirm delete, another tab adds child, delete tries | Conflict; unseen child and whole existing subtree survive |
| Forbidden move | Move parent under own descendant | Validation failure with zero writes |
| No persistence | persist is unavailable/denied | Saving still succeeds without claiming durable backup |

## Task 4: Add the local vault session and passphrase screens

**Files:** Create vault/session.ts, VaultProvider.tsx, VaultScreen.tsx, ChangePassphraseDialog.tsx, app/SettingsDialog.tsx; tests/vault.session.test.tsx. Modify App.tsx to gate library access.

**Interfaces:** Produces useVault and the setup/unlock/lock screens; consumes Task 2 crypto and Task 3 repository. requestLock accepts dirty-editor save/discard/cancel handlers; automaticLock seals any dirty draft into an in-memory envelope before releasing keys.

- [ ] **Step 1:** Write lifecycle cases below using fake timers for inactivity and explicit visibility transitions. Run npm run test -- tests/vault.session.test.tsx and confirm the lifecycle behaviors fail.
- [ ] **Step 2:** Implement setup with passphrase confirmation and Import backup entry point, unlock with one passphrase field, safe failure copy, and Unlocking progress. No account language, strength meter subsystem, or remote requests.
- [ ] **Step 3:** Implement session lifecycle with a ten-minute inactivity deadline. Track keyboard/pointer/touch actions and recompute deadlines on visibility/focus. Conceal secrets as soon as hidden, lock after sixty seconds hidden, and lock immediately upon resume if the deadline already elapsed.
- [ ] **Step 4:** Seal dirty drafts into purpose-bound encrypted session-memory envelopes before automatic lock. Clear decrypted library/search/reveals and key references once sealed. Recover only after unlocking the same vault ID and generation. If sealing fails, conceal the editor and enter lock-error with Save/Discard recovery; do not falsely report Locked.
- [ ] **Step 5:** Implement manual lock choices, unlock draft recovery, and change-passphrase rewrap. A canceled lock leaves the draft intact. A failed Save and lock keeps the editor accessible. Lock is current-tab only, which must be stated in the session/storage documentation.
- [ ] **Step 6:** Handle other-tab vault/header changes. With no dirty draft, release the session and show unlock again. With a dirty draft, conceal normal library UI and show recovery actions: export a backup of the old in-memory library including the draft, or discard and reload. Use the Task 9 backup helper when available; before it exists, the test harness can verify the recovery callback without shipping a broken button. Never silently throw away the draft.
- [ ] **Step 7:** Run focused tests, typecheck, and lint; manually verify a backgrounded phone returns locked after the deadline. Commit feat: add local vault session and locking.

| Test | Given / When | Required assertion |
| --- | --- | --- |
| Setup | Valid phrase/confirmation and empty storage | One empty vault created; user reaches Scratch |
| Wrong phrase | Existing vault and incorrect unlock | Locked state remains; records unchanged |
| Reload | Unlock, then reconstruct app | Starts locked; no key restored from storage |
| Hidden timer | Hide for sixty seconds, resume with throttled timers | Locked before any plaintext content appears |
| Dirty automatic lock | Type without saving, auto-lock, unlock same vault | Draft recovered; sealed state contains no plaintext |
| Seal failure | Encryption throws during auto-lock | Concealed lock-error state; no claim of completed lock |
| Cancel manual lock | Dirty draft, choose Cancel | Editor unchanged |
| Save failure | Dirty draft, Save and lock returns quota | Stays editable; locked state not entered |
| Passphrase change | Rewrap after verifying current phrase | New phrase unlocks; content unchanged |

## Task 5: Implement big tiles and reliable collection navigation

**Files:** Create navigation.ts, useNavigation.ts, CollectionView.tsx, CollectionTile.tsx, NoteTile.tsx; tests/navigation.test.tsx. Modify AppHeader, TileGrid, App, LibraryProvider.

**Interfaces:** Produces useNavigation and the collection view; consumes useLibrary/useVault and shared display/hierarchy functions. NoteTile separates open, copy, and menu controls.

- [ ] **Step 1:** Write route/tile cases below, including 80-cluster titles and duplicate titles. Run npm run test -- tests/navigation.test.tsx.
- [ ] **Step 2:** Implement strict ID-only hash routing and browser history. Handle unknown/deleted parents by walking available ancestry when known, otherwise returning home. Do not restore a route containing decrypted text.
- [ ] **Step 3:** Render the root grid and nested collection grids with stable ordering, immediate child counts, named color tints, icons, neutral note cards, and masked secret cards. Link targets use actual IDs; duplicate titles are not an identity problem.
- [ ] **Step 4:** Implement full desktop breadcrumbs and shortened mobile ancestry with an accessible ancestor menu. Breadcrumb root says Scratch. Keep collection name visible without repeating a marketing-style page title.
- [ ] **Step 5:** Wire Add menu and empty actions to creation callbacks and note route to editor callbacks. Task 6/7 supply those implementations. Keep test fixtures out of production startup.
- [ ] **Step 6:** Run focused tests plus layout checks in both themes at 320, 360, 768, and 1280 px. Ensure long unbroken titles wrap/clamp inside the tile while their full title remains accessible. Commit feat: browse Scratch collections with large tiles.

| Test | Given / When | Required assertion |
| --- | --- | --- |
| Core hierarchy | Click API Tokens then OpenAI | Correct ID-based collection/note route opens |
| Back/Forward | Navigate into child, go Back then Forward | Previous grid and note route restore correctly |
| Invalid hash | Non-UUID or deleted item in hash | Safe fallback and brief message, no crash |
| Item count | Collection contains one note and one collection | Shows 2 items, not 2 notes |
| Duplicate names | Two notes share title | Each opens its own content |
| Nested controls | Activate Copy/menu using keyboard | Navigation is not accidentally triggered |
| Secret preview | Secret note rendered in grid | Eight dots; no body text/title derivation |
| Long title | 80 clusters or unbroken string at 320 px | No horizontal page overflow; full accessible label |

## Task 6: Deliver quick note capture and explicit editing

**Files:** Create NoteEditor.tsx, useNoteDraft.ts; tests/note.editor.test.tsx. Modify App, NoteTile, SettingsDialog, navigation guard integration.

**Interfaces:** Produces NoteEditor and dirty-editor save/discard callbacks; consumes repository createNote/updateNote and vault session. Draft state has initial input, current input, parent, existing identity/version, dirty flag, and saving/error state.

- [ ] **Step 1:** Write editor cases below. Run npm run test -- tests/note.editor.test.tsx. Use meaningful repository outcomes, not assertions about internal CSS classes.
- [ ] **Step 2:** Implement body-first creation with autofocus, collapsed optional title, Secret toggle, Save/Cancel, exact validation messages, and no rich-text toolbar. Require a title when Secret is enabled. Changing ordinary to Secret immediately removes any in-memory body search entry once committed.
- [ ] **Step 3:** Implement reading/editing an existing note, a 30-second reveal timeout, immediate re-masking when hidden/closed/locked, and the explicit Edit secret action. Never put secret content into aria labels, error messages, or toast announcements.
- [ ] **Step 4:** Connect Save to the repository and keep Save disabled while the transaction is pending. Report Saved and close only after committed success. Failure keeps body/title/cursor focus available and announces a safe error. A normal successful save returns focus to the tile or Add trigger.
- [ ] **Step 5:** Implement dirty-state guards for Cancel, Escape, internal navigation, browser Back, manual lock, and beforeunload. Ignore Ctrl/Cmd+Enter during IME composition. Ctrl/Cmd+Enter and the button share the same save path. Whitespace is preserved but whitespace-only notes fail.
- [ ] **Step 6:** Implement conflict recovery with Latest and Your draft visible without overwriting either. For a same-vault conflict, allow Keep editing, Load latest after discard confirmation, or Save as a new note using a refreshed context. If generation changed, use Task 4's old-library backup recovery or discard/reload; do not save an old draft into an unidentified new vault.
- [ ] **Step 7:** Verify the full-screen mobile editor with the software keyboard and viewport resizing. Keep Save/Cancel reachable using sticky actions and dynamic viewport units. Run focused tests, typecheck, and lint; commit feat: capture and edit short notes.

| Test | Given / When | Required assertion |
| --- | --- | --- |
| Minimal capture | Add Note, type body only, Save | One note created in current collection; title derived |
| Exact content | Body with leading spaces, newlines, Unicode | Stored body is byte-for-byte equivalent after UTF-8 round trip |
| Secret validation | Paste fixture token, enable Secret, leave title blank | Save blocked; token never appears as generated title |
| Failed save | Repository returns quota/unavailable | Dialog stays open; draft unchanged; no Saved announcement |
| Repeated submit | Double-click Save or press shortcut repeatedly | At most one write/created note |
| IME | Press shortcut while composition active | No premature save |
| Dirty Back | Unsaved edit, browser Back, choose Keep editing | Route/editor restored; draft survives |
| Stale update | Another tab saved newer body | Conflict shown; newer persisted body unchanged |
| Reveal expiry | Reveal, wait 30 seconds or hide document | Secret remasked; copy remains explicit |
| Mobile keyboard | 360 px viewport shrinks with keyboard | Save/Cancel reachable; textarea can scroll |

## Task 7: Add collection creation and focused organization

**Files:** Create CollectionEditor.tsx, MoveDialog.tsx, DeleteDialog.tsx; tests/collection.actions.test.tsx. Modify collection/note overflow menus, App, CollectionView.

**Interfaces:** Consumes createCollection/updateCollection/moveItem/deleteItem; produces accessible editor, eligible-destination picker, and permanent-delete confirmation. Reuse shared tree rules rather than duplicate checks in UI.

- [ ] **Step 1:** Write organization cases below and run npm run test -- tests/collection.actions.test.tsx.
- [ ] **Step 2:** Implement Add Collection with required title, Sage default, four named color buttons, and current parent. Rename/color changes use the same editor. Permit duplicate titles but reject blank names and overlong grapheme counts.
- [ ] **Step 3:** Implement Move picker showing root Scratch and eligible collection paths, with keyboard/touch selection. Exclude descendants/self and destinations that exceed depth eight. An item already at a destination gives a harmless no-change result, not a fake mutation.
- [ ] **Step 4:** Implement confirmation dialogs for notes and collection subtrees. Collection copy states its total descendant count and that deletion is permanent. The repository rechecks revision before deleting; a conflict asks the user to review the updated count.
- [ ] **Step 5:** After moving/deleting, repair current route and focus. If the viewed collection disappeared, return to its surviving parent or Scratch. Update counts from the committed snapshot, never from speculative state that might roll back.
- [ ] **Step 6:** Run focused tests, typecheck, lint, and a touch/keyboard walkthrough. Commit feat: organize notes within collections.

| Test | Given / When | Required assertion |
| --- | --- | --- |
| Create | Name plus Clay, Save | Correct collection/color/parent persists |
| Rename | Rename parent with children | Child IDs/relationships stay intact; paths update |
| Move note | Move child to Scratch | Root gains note and original count decreases |
| Prevent cycle | Move parent below child | Destination unavailable; repository also rejects bypass |
| Depth limit | Move subtree would produce level nine | Cannot commit; eight-level boundary succeeds |
| Confirm subtree | Collection with nested notes, Delete | Exact descendant count; cancel writes nothing |
| Concurrent deletion | Another tab adds child after dialog opens | Conflict and updated confirmation required |
| Current route deletion | Delete the collection being viewed | Surviving parent/home shown with valid focus |

## Task 8: Implement private search and dependable copying

**Files:** Create search/search.ts, useSearch.ts, SearchResults.tsx; clipboard/copy.ts; tests/search.test.ts and clipboard.test.ts. Modify AppHeader, NoteTile, NoteEditor, LibraryProvider.

**Interfaces:** Produces buildSearchIndex, searchItems, useSearch, copyNote. Index entries include id, kind, displayTitle, parentPath, and normalized searchable text. Secret entries omit body entirely. Index clears on lock and rebuilds only from validated committed snapshots.

- [ ] **Step 1:** Add search/clipboard cases below; run npm run test -- tests/search.test.ts tests/clipboard.test.ts.
- [ ] **Step 2:** Build a case-insensitive NFC search index from collection titles and ordinary title/body text, and from secret titles only. Apply 150 ms debounce to the query. Empty query restores the previous collection; empty matches show No matches.
- [ ] **Step 3:** Display result tiles using the same collection/note components with parent paths. Result activation navigates to the containing collection and opens a note by ID. Search input remains ephemeral; never save or send it.
- [ ] **Step 4:** Implement clipboard writes from an explicit user action under HTTPS. Preserve exact text; announce Copied only after the promise resolves. On permission/unavailable failure, keep the note and show Select text for ordinary notes or Reveal to copy manually for secrets. Do not implement timed clipboard clearing.
- [ ] **Step 5:** Clearing/locking/replacing the library destroys index references, timers, and result state. Ensure a just-converted Secret note cannot match its former ordinary body after the successful mutation.
- [ ] **Step 6:** Run focused tests, typecheck, lint, and a manual clipboard denial check. Benchmark 1,000 synthetic notes; record search timing rather than treating targets as already achieved. Commit feat: find and copy notes privately.

| Test | Given / When | Required assertion |
| --- | --- | --- |
| Ordinary content | Search body substring in different case | Correct item/path matches |
| Unicode | Composed/decomposed equivalent query | Matching display text found; stored text unchanged |
| Secret body | Search fixture token, including while revealed | Zero body matches; title still searchable |
| Secret conversion | Ordinary note becomes Secret | Former body match disappears immediately after commit |
| Lock cleanup | Active query then lock | Index/results cleared and no body in announcements |
| Exact copy | Multiline note with trailing newline | Clipboard receives exact body |
| Denied clipboard | Clipboard rejects | No Copied toast; actionable manual-copy state |
| Copy control | Click copy on note tile | Does not also navigate/open editor |

## Task 9: Provide encrypted exports and atomic replacement imports

**Files:** Create backup/types.ts, backup.ts, BackupDialog.tsx; tests/backup.test.ts. Modify SettingsDialog, VaultScreen, VaultProvider; update docs/storage-format.md.

**Interfaces:** Produces exportBackup and prepareImport; consumes purpose-bound crypto envelopes/readStoredSnapshot/replaceLibrary. Also produces exportRecoveryBackup(session, memorySnapshot, dirtyDraft), which applies the unsaved draft as a new/edit note to a copy of the old in-memory snapshot, validates it, encrypts changed records, and exports it without writing the replaced database. Invalid/empty drafts remain editable rather than being exported as invalid notes.

- [ ] **Step 1:** Define the exact backup fields from the brief. Serialize the snapshot envelope's plaintext as vaultId plus the complete StoredItem array sorted by ID. The outer header's wrapper authenticates its KDF fields, and the envelope authenticates the full record set. No theme/query is exported.
- [ ] **Step 2:** Write backup cases below using synthetic content and real crypto. Run npm run test -- tests/backup.test.ts to see failures before export/import implementation.
- [ ] **Step 3:** Implement consistent snapshot read followed by backup encryption outside the transaction. Standard export verifies the stored generation/vault ID/header wrapper still match the session before encrypting; a stale header/session requests refresh rather than producing an ambiguous backup. Recovery export deliberately uses its captured old header and snapshot. Validate file size before download and produce the local-time filename. Revoke object URLs after download handling. Existing saved content and valid recovery drafts use the same versioned backup writer.
- [ ] **Step 4:** Implement strict preflight size/format/base64/parameter validation before derivation, then unwrap/decrypt the envelope and every record, then validate payloads and the entire graph. Wrong phrase/corruption never generates an empty library or asks the database to clear itself.
- [ ] **Step 5:** Implement initial import and replacement UI: choose file, enter backup passphrase, preview item count, offer Export current backup, confirm Replace or Cancel. For replacement, require current vault unlocked and no dirty editor. Imported passphrase is stated to become the current passphrase; theme remains unchanged.
- [ ] **Step 6:** Commit prepared records with one replacement transaction and fresh generation. Abort on changed revision/generation or any write error. Clear old plaintext session only after success, install the imported session with new generation, then open Scratch. Notify other tabs with metadata only; their dirty recovery backup uses their old in-memory snapshot and key.
- [ ] **Step 7:** Test round-trip transfer in two independent browser contexts, including browser download/upload handling. Run focused tests, typecheck, lint; commit feat: back up and restore encrypted Scratch libraries.

| Test | Given / When | Required assertion |
| --- | --- | --- |
| Transfer | Export library A, import into fresh B | IDs, exact bodies, secrecy, colors, hierarchy survive |
| Export privacy | Read downloaded file as text | Neither fixture token nor ordinary body/title appears |
| Full-set authentication | Remove/alter a record inside snapshot ciphertext | Authentication fails, not a partial valid restore |
| Bad passphrase | Valid backup, wrong phrase | Safe error; old library unchanged |
| Preflight | >32 MiB, unknown version, malformed base64/KDF | Rejected before crypto work/DB writes |
| Structural invalidity | Authenticated synthetic backup with duplicate IDs/cycle/missing parent | Validation rejects; old library unchanged |
| Capacity | Authenticated backup with 1,001 items | Rejected; 1,000 valid items accepted |
| Maximum valid backup | 1,000 notes with maximum title/body bytes | Export remains below 32 MiB and can be restored |
| Interrupted replace | Inject error halfway through transaction | Original header/items/meta remain intact |
| Concurrent replace | Another tab changed revision after preview | Conflict; no overwrite until a new review |
| Cancel | Preview valid backup then Cancel | No changed data or active passphrase |
| Old passphrase backup | Change phrase after exporting | Old file needs old phrase; new file needs new phrase |
| Dirty stale tab | Replace in A while B edits, export recovery in B | Recovery backup includes B's draft and old library; new A library untouched |

## Task 10: Make the static app available offline and updates safe

**Files:** Create offline/register.ts, UpdateNotice.tsx, public/icons assets, tests/e2e/offline.spec.ts. Modify vite.config.ts, App, README and manifest configuration.

**Interfaces:** Produces service-worker registration state and an UpdateNotice that consumes dirty-editor save/discard guards. Generated worker owns only precached static asset requests.

- [ ] **Step 1:** Configure the smallest static precache using vite-plugin-pwa's generated worker and prompt update mode. Bundle manifest name/short_name Scratch, start_url ./, scope ./, display standalone, default light background/theme colors, and local icons. No user-data fetch handlers or runtime caching of arbitrary requests.
- [ ] **Step 2:** Add offline browser cases below against the production preview build, not a development server. Run npm run build, then npm run test:e2e -- tests/e2e/offline.spec.ts and confirm the initial offline-reopen behavior fails before registration is connected.
- [ ] **Step 3:** Connect registration, first-control status, and update-ready notice. Explain in README that a first online visit is required. Handle worker unsupported/registration failure without affecting online note storage.
- [ ] **Step 4:** Gate update activation/reload behind the dirty-editor Save/Discard/Cancel flow. A failed save cancels activation. On user-approved reload, show the normal locked vault screen; keys do not survive updates.
- [ ] **Step 5:** Verify offline startup, unlock, create/edit, search, and export. Import consumes a local file and also works offline. Confirm cache storage contains only shell/assets/fonts/icons, never downloaded backups or decrypted data.
- [ ] **Step 6:** Run build and the focused production-preview cases; commit feat: support offline Scratch and safe updates.

| Test | Given / When | Required assertion |
| --- | --- | --- |
| Warm offline | Load online, wait for worker control, close, reopen offline | Shell/unlock works and saved notes remain accessible |
| Offline write | Save and reload after offline startup | Note persists locally without request failures |
| Unseen install | Fresh browser starts offline | No promise that the app can load before initial installation |
| Update while dirty | New build available, dirty editor, Cancel | Worker waits; draft remains |
| Save failure update | Save before update fails | No activation or forced reload |
| Cache privacy | Inspect cached responses | No note payloads, secret text, or backups |

## Task 11: Verify the complete focused product and document limits

**Files:** Create tests/e2e/scratch.spec.ts, secrets.spec.ts, transfers.spec.ts, accessibility.spec.ts; update playwright.config.ts, README, docs/verification.md. Modify product files only when an observed defect requires it.

**Interfaces:** No new feature interfaces. This task verifies the integrated contracts and produces measured evidence; it does not add features during polish.

- [ ] **Step 1:** Configure desktop Chromium/Firefox/WebKit and a mobile WebKit-style viewport plus mobile Chromium. Include 360 px/1280 px functional runs; check 320 px and 200% zoom separately. Use synthetic fixtures and a deterministic clock where useful, never real tokens. Populate browser tests through real UI creation or encrypted backup import, not production-only debug hooks. Add a required-API absence check for the unsupported-browser screen.
- [ ] **Step 2:** Write end-to-end flows: create library, create API Tokens collection, save titled OpenAI Secret note, save ordinary note without title, edit, nest/move, navigate Back/Forward, search/copy, change theme, reload/unlock, export to a second context, and restore offline. Assert user-visible outcomes and persistence, not implementation internals.
- [ ] **Step 3:** Add secret-specific checks across visible text, accessible names, URLs, raw IndexedDB/Cache/localStorage, exports, clipboard errors, and network requests. Confirm no content-bearing network requests occur and no mocked security shortcut was left in production.
- [ ] **Step 4:** Run accessibility checks plus keyboard-only walkthroughs for dialogs, tile menus, search, move, delete, lock, and backup. Automated checks may use @axe-core/playwright as a test-only dependency. Manually verify screen-reader announcements, actual phone keyboard, IME, and reduced motion.
- [ ] **Step 5:** Capture light/dark home, collection, editor, settings, and empty/search/error states at desktop/mobile sizes. Use screenshots as a review artifact; evaluate B's big tiles and restrained typography against the brief. Do not write brittle snapshots for every CSS detail.
- [ ] **Step 6:** Run npm run typecheck, npm run lint, npm run test, npm run build, and npm run test:e2e once against the final changed build. Fix observed failures and rerun the affected checks; widen repeats only when the fixes affect other contracts.
- [ ] **Step 7:** Measure warm navigation, 1,000-note search, initial JS gzip, and unlock time on a real phone. Record actual numbers and environment in docs/verification.md. If budgets fail, simplify/split loading paths before adding virtualization or a new framework; never lower the KDF count silently.
- [ ] **Step 8:** Write README instructions for local development, production static hosting, stable HTTPS origin, theme behavior, no sync, backup transfer/replace semantics, passphrase loss, old-backup passphrases, browser-data clearing, and first-visit offline limits. Configure future hosting with a restrictive Content Security Policy: same-origin scripts/fonts/styles/assets, no content API connections, no objects, no framing, and no unsafe-eval. The small pre-paint theme bootstrap needs a build-generated CSP hash or a same-origin external script; never allow unsafe-inline scripts just to make it work.
- [ ] **Step 9:** Commit test: verify focused Scratch workflows. Produce a final execution report linking measured verification and any material remaining defect. Static hosting configuration is preparation only; deployment itself requires a future instruction authorizing it.

| Integrated case | Required assertion |
| --- | --- |
| Main task speed | Unlocked Add > Note > type > Save needs no title, folder wizard, or onboarding detour |
| Responsive parity | Same capture/find/copy/move/backup capability on desktop and phone |
| Theme quality | Both themes cover every dialog/error/empty state; no purple accents or generic display fonts |
| Data longevity | Reload locks but retains saved data; backups restore exact content in independent contexts |
| Dirty lifecycle | Cancel/Back/lock/update/failure never silently overwrite or dismiss a dirty draft |
| Accessibility | Focus, names, target sizes, contrast, zoom, reduced motion meet the brief |
| Offline | Warm offline reopen and local operations work without a server |
| Scope discipline | No AI, cloud sync, account, collaboration, rich editor, or extra productivity navigation |

## D. Requirement coverage and completion criteria

| Design requirement | Implementation tasks | Verification |
| --- | --- | --- |
| Scratch naming and B layout | 1, 5 | Theme/navigation tests and screenshots |
| Desktop/mobile, light/dark | 1, 5, 6 | Theme tests, mobile keyboard, accessibility E2E |
| Separate collection/note hierarchy | 2, 3, 5, 7 | Graph/repository/navigation/action tests |
| Short capture and optional title | 2, 6 | Editor tests and main capture E2E |
| Actual tokens with safe display | 2, 4, 6, 8 | Crypto tests and secrets E2E |
| Local per-browser persistence | 3, 4 | Reload, unavailable/quota and independent-context tests |
| Export/import | 9 | Privacy, rollback, structural validation, transfer E2E |
| Copy and global search | 8 | Exact-copy/denial and secret-search tests |
| Atomic/conflict-safe organization | 3, 7, 9 | Stale writes, concurrent subtree/import tests |
| Accessible, restrained UI | 1, 5, 6, 11 | Contrast and keyboard/zoom/screen-reader review |
| Offline shell and safe updates | 10 | Production offline/update cases |
| Simplicity and no execution now | All; this document's boundary | Review actual future UI scope; no product files in this assignment |

Future implementation is complete when all task deliverables work together, required checks pass, real-phone verification is recorded, storage/backup limits are documented, and no material data-loss/security/usability defect remains. Passing tests alone does not establish visual quality or phone-keyboard usability.

## E. Plan self-review

- Confirmed requirements and proposed defaults are separated in the brief. No unasked cloud service or account is assumed.
- All shared names, fields, signatures, error codes, and route shapes are defined before consumption. Crypto awaits happen outside database transactions.
- The no-code instruction overrides the writing-plans skill's sample-code preference; every task still has concrete behavior, files, tests, commands, and acceptance assertions.
- Each Review Focus entry has explicit owning tests. Backup corruption and cross-tab replacement are tested separately from happy-path transfers.
- The file map has no extra framework, backend, plaintext cache, or permanent draft store. Maximum supported library size makes full in-memory validation/search intentional.
- Data keys are nonextractable in the active session; passphrase rewrap deliberately uses verified temporary raw material from the old wrapper, not an impossible export operation.
- Automatic lock retains only an encrypted in-memory dirty draft after a successful seal. A seal failure is a recovery state, not a false security claim.
- No execution, dependency installation, Git initialization/commit, deployment, or subagent dispatch was performed to create this plan.

## F. References and stopping point

The [design brief's official references](../specs/2026-09-30-scratch-design.md#9-official-references-checked-for-this-plan) support the platform choices. Recheck package compatibility when implementation starts; this plan deliberately pins behavior/contracts rather than asserting future package release numbers.

This document is the final planning deliverable for the current request. Review it and adjust planning defaults if desired. Choosing an execution approach and implementing the app belong to a separate, explicitly requested assignment.
