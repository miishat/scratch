# Changelog

All notable changes to Scratch are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Color schemes.** Settings now offers a color scheme for each theme. Light:
  Parchment (new default), Classic (the original), and Rosewater. Dark:
  Espresso (new default), Slate, and Forest. Each theme remembers its own
  choice, only the schemes for the active theme are shown, and the choice is
  applied before first paint.
- **Card styles.** Settings has a Notes picker (Index Card, Paper Sheet, Sticky
  Note, Quiet) and a Collections picker (Stacked, Classic, Folder Tab, Color
  Edge), each with a drawn preview. Choices apply instantly and are saved.
- **Logo.** A pencil mark beside the wordmark in the header and a matching
  favicon. The installed app icon, now also a cream pencil on the accent
  color, matches it.
- **Edit button on notes.** Every note card has an Edit button that opens the
  note straight in the editor instead of the reader.
- **More collection colors.** Rose, Lilac, Sky, and Stone join Sage, Clay,
  Ochre, and Slate, with contrast checked in all six schemes.
- **Deployment.** A GitHub Actions workflow typechecks, lints, tests, and builds on
  every push and pull request, and publishes to GitHub Pages from main. Notes on
  setup and on security headers are in docs/deployment.md.
- **Tests.** Contrast checks now cover every color scheme
  and every collection color. New tests cover the pickers and the Edit button,
  and the browser specs were updated for the + Note and + Collection buttons.
- **Numbered lists.** Pressing Enter at the end of a numbered line in a note
  (1. or 1)) starts the next number in the same style. Enter on an empty
  numbered line ends the list.

### Changed

- **Warmer light mode.** The default light scheme is a warm parchment instead
  of near white. The original is still available as Classic.
- **Typography.** Newsreader is used for the wordmark, titles, headings, and
  note text, and Public Sans for controls and everything else. The Source Sans
  and Source Serif fonts and their license files were replaced.
- **Install colors.** The installed app's splash and theme colors match the new
  parchment light scheme.
- **Unlock and setup screens.** A centered card under the pencil logo and
  wordmark, with the passphrase as a placeholder instead of a label. The Unlock
  heading is kept for screen readers.
- **Header buttons.** The Add menu is replaced by two buttons, + Note and
  + Collection, both with the accent color.
- **Note cards.** Cards use an index card layout: a title row with an accent
  rule, the preview, and a footer with Edit, Copy, and the actions menu.
- **Collection cards.** Collection cards are stacked by default. The Paper
  Sheet fold takes its color from the active scheme's accent.
- **Card buttons.** Buttons on note cards are smaller (32 px) and outlined in
  the accent color. On collection cards the actions button is a notch in the
  top-right corner, a deeper shade of the card's own color with white dots. It
  appears on hover or focus and is always visible on touch screens.
- **Settings.** Reorganized into Appearance, Security, and Backup with no
  explanatory copy. Buttons are Lock Current Tab, Change Passphrase, Export,
  and Import, and Lock Current Tab is now a plain button instead of looking
  selected. The color heading reads Light Colors or Dark Colors.
- **Collection page.** The current collection's name is shown once, in the
  breadcrumb, with its actions button at the end of that row. The large heading
  is kept for screen readers and for narrow screens.
- **Dialogs.** The backdrop is blurred. The close button is smaller and aligned
  with the title. The collection actions menu says Edit instead of Edit
  collection.
- **Longer sessions.** Scratch locks after thirty minutes without activity
  (was ten) and after ten minutes with the tab hidden (was sixty seconds), so
  switching apps on a phone no longer asks for the passphrase again. A reload
  still starts locked.
- **Password manager.** The setup and unlock forms include a hidden username so
  the device can save and fill the passphrase.
- **Import file picker.** The Choose File button follows the color scheme.
- **Phone editor.** The note editor is a bottom sheet sized to its content
  instead of a full-screen panel.
- **Secret note hint.** Now sits under the checkbox, aligned with its label.
- **Target sizes.** Card actions and the dialog close button are 32 px, above
  the 24 px WCAG 2.2 AA minimum. Primary controls stay at 44 px.

### Fixed

- **Settings icon.** The gear is now a proper gear outline instead of a shape
  that looked like an eye.
- **Note title focus ring.** The highlight around the title field no longer
  gets cut off in the editor.
- **Delete dialog.** The redundant close cross is gone; Cancel remains.
- **Dialog close button.** Now a 36 px square instead of a stretched shape.
- **Scrollbars.** Thin and tinted from the active theme.
- **Secret note option.** The checkbox is centered against its label and hint.

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
