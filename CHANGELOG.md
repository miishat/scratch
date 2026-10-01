# Changelog

All notable changes to Scratch are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-01

First release: a local-first, encrypted notes app that runs in the
browser and installs as an app on desktop and phone.

### Added

- **App shell and themes.** Responsive layout for desktop and phone, large
  colored collection tiles, and light and dark themes with a System, Light, or
  Dark choice in Settings. The theme is applied before first paint.
- **Encrypted library.** Every note and collection is encrypted with AES-GCM.
  The data key is wrapped by a passphrase through PBKDF2 (600,000 iterations)
  and is never stored in readable form. Envelopes are bound to their purpose,
  so a draft can never be swapped for a backup.
- **Atomic local storage.** An IndexedDB repository with revision, generation,
  and per-item version checks. A failed or interrupted write leaves saved data
  intact. Other tabs are notified through metadata-only messages.
- **Vault and locking.** Passphrase setup and unlock, automatic lock after ten
  minutes of inactivity or sixty seconds hidden, manual lock, and passphrase
  change. An unsaved draft is sealed in memory before an automatic lock and is
  restored after unlock.
- **Collections and notes.** Create, rename, recolor, nest, move, and delete
  collections with an exact descendant count and permanent-delete
  confirmation. Notes and collections are distinct tile types, with hash-based
  navigation that never puts titles or content in the URL.
- **Quick capture and editing.** Body-first note capture with an optional title
  and a Secret toggle. Secret notes require a title, mask their body, and
  reveal it for thirty seconds on request. Dirty-draft guards cover Cancel,
  Escape, Back, lock, and updates, and conflicts are shown side by side
  without overwriting either version.
- **Search and copy.** Private, in-memory search over collection titles and
  ordinary note text, with secret titles searchable and secret bodies never
  indexed. One-tap copy preserves exact text and reports failure honestly.
- **Backup and restore.** Passphrase-protected encrypted export and atomic
  replacement import with strict preflight, full-set authentication, and
  structural validation. A recovery export preserves an unsaved draft when
  another tab replaced the library.
- **Offline and install.** Installable web app with an offline shell. Updates
  never reload a tab with an unsaved draft and always return to the locked
  screen.
- **Content Security Policy.** A strict policy for static hosting with no
  inline scripts, plus a test that fails if the policy weakens.
- **Verification.** Unit, browser, accessibility, contrast, and secret-leak
  suites, with measurements and open manual checks recorded in
  `docs/verification.md`.

### Security

- Secret note bodies never appear in titles, previews, search results, the URL,
  accessible names, announcements, storage, caches, or exports.
- Backups contain no readable content, and a malformed, truncated, oversized,
  wrong-passphrase, or structurally invalid backup never replaces the current
  library.
- Unwrapped data keys must be exactly 32 bytes.

### Known limitations

- Data lives in each browser and does not sync. Use export and import to move
  it between devices.
- A lost passphrase cannot be recovered.
- Firefox, real phones, screen readers, input method editors, and real browser
  zoom have not been tested. The remaining manual checks are listed in
  `docs/verification.md`.
