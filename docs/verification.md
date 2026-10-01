# Scratch verification record

What was run, on what, what it showed, and what still needs a person with a real device. Nothing below is claimed beyond what is stated. Date of the runs: 2026-10-01.

## Environment

| Item | Value |
| --- | --- |
| Machine | AMD Ryzen 7 7700X, 8 cores / 16 threads, 31 GiB RAM, desktop |
| OS | Windows 11 Home 10.0.26200 |
| Node | 22.13.1 |
| Chromium (Playwright) | 153.0.8010.12 |
| WebKit (Playwright) | 26.6 build 2359 (the Playwright WebKit port, not Safari) |
| Firefox (Playwright) | 155.0 installed, **cannot start on this machine** (see below) |
| Playwright / axe-core/playwright | 1.63.0 / 4.13.0 |
| Build | `npm run build`, Vite 8.3.1, production, with the service worker |

## Summary of results

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm test` | 18 files, 382 tests passed (1 measurement helper skipped without `MEASURE=1`) |
| `npm run build` | succeeds (precache 32 entries, 696 KiB) |
| `npm run test:e2e` | see "End-to-end results by project" |

## End-to-end results by project

Run against `vite preview` of the production build, which applies the Content Security Policy from `public/_headers`.

| Project | Specs | Passed | Skipped | Failed |
| --- | --- | --- | --- | --- |
| chromium (desktop, 1280 px) | scratch, transfers, reflow, offline, secrets, support, accessibility, csp | 54 | 0 | 0 |
| webkit (desktop, 1280 px) | same as chromium | 53 | 1 (the build-file grep runs once, on chromium) | 0 after the fix below |
| mobile-chromium (Pixel 7 emulation, 360 px) | scratch, transfers, reflow | 10 | 2 (the 320 px and 200% walks run on the desktop projects) | 0 |
| mobile-webkit (iPhone 13 emulation, 360 px) | scratch, transfers, reflow | 10 | 2 (same) | 0 |
| firefox | not run | not run | | cannot start on this machine |

The single full run (`npm run test:e2e`, 2 workers, about 3.5 minutes, 132 tests) ended with 125 passed, 5 skipped, 2 failed. Both failures were WebKit keyboard tests in `accessibility.spec.ts`, and both were test timing or engine behavior, not product defects: one test moved focus within about 10 ms of saving a note, before the editor had handed focus back to Add (the test now waits for that), and one expected tab stops on tile links, which Safari and its WebKit port skip by default (now asserted on the other engines only). After that test-only change the keyboard tests passed 3 times on WebKit and on Chromium, and `accessibility`, `csp`, `secrets`, `scratch`, and `reflow` passed 3 consecutive repeats on Chromium (162 tests, 0 failures, 0 flaky). The product code did not change after the full run.

### Firefox was NOT run

The Firefox 155.0 binary installed by Playwright fails to start on this machine (`side-by-side configuration is incorrect`, Playwright reports `spawn UNKNOWN`), which needs a system runtime this machine lacks. No Firefox behavior is claimed anywhere in this document. `playwright.config.ts` leaves the project out with a warning when Firefox cannot launch, and `REQUIRE_FIREFOX=1 npm run test:e2e` throws instead, so a release gate can refuse to pass without it. Follow-up: run `REQUIRE_FIREFOX=1 npx playwright test --project=firefox` on a machine where Firefox starts.

### What the browser tests cover

- `scratch.spec.ts` (all projects): the full journey (create library, API Tokens collection, titled OpenAI Secret, untitled ordinary note, edit, nest and move, Back and Forward, search and copy, theme following the system, an explicit Dark choice made in Settings surviving a reload while the system is light, reload and unlock, export, restore in a second context including revealing the restored secret, real offline reopen and write); the main capture speed; capability parity at each width; the dirty-draft lifecycle (Cancel, Back, idle lock, failed save with the reason shown and nothing written, focus containment).
- `reflow.spec.ts`: 320 px and 200% zoom (640 px layout width) walks run on the two desktop projects only (the slow key derivations repeat per walk); a long unbroken Unicode title (stacked accents, family emoji, 65 clusters) is part of those walks. The 44 px target-size check runs on every project.
- `secrets.spec.ts`: a secret across visible text, accessible names, attributes, URLs, console, raw IndexedDB, Cache storage, local and session storage, exports, clipboard refusals, and every network request, with a positive control showing the scanner sees the token while it is revealed; the 30 second auto-hide with a controlled clock; hide when the document becomes hidden.
- `accessibility.spec.ts`: axe-core (WCAG 2.0, 2.1, and 2.2 A and AA tags) on 24 screens and states in light and dark at 1280 px and 360 px; keyboard-only walkthroughs; reduced motion; palette.
- `csp.spec.ts`, `offline.spec.ts`, `transfers.spec.ts`, `support.spec.ts` as named.

### Limits of these tests

- The phone projects are Playwright device emulation (user agent, touch, 360 px viewport), not real phones.
- 200% zoom and 320 px are emulated as viewport widths. Real browser zoom and operating-system text scaling are not scriptable here.
- Service worker requests are reported only by some engines (`request.serviceWorker()`); the "no content request" assertion covers page requests on every engine and worker requests where the engine reports them. The worker has no fetch handler or runtime caching, which the build smoke check and the cache-contents test support.
- The `dist` grep in `secrets.spec.ts` is a smoke check (names and literals), not proof that no hook exists.
- The visibility test dispatches the event a browser fires; whether a real phone fires it when switching apps is a manual check.
- WebKit `setOffline` breaks navigations in Playwright, so offline tests stop a controlled host instead (real offline), on all engines.

## Accessibility

### Automated and keyboard checks (run)

- axe-core on setup (plain, with a form error, first-use import), empty home, home with tiles, empty collection, collection, reader (masked and revealed), editor, unsaved-changes prompt, tile menu, Move, Delete, new-collection dialog, search with and without results, Settings, Change passphrase, backup import, locked, locked with a wrong-passphrase error, editor with a failed save, and the unsupported-browser screen. Light and dark, at 1280 and 360 px. No violations.
- Keyboard only: Add menu (open, items, Escape, focus returns to Add); new note (focus lands in the body, Tab stays in the dialog, Escape closes a clean editor and returns to Add); dirty editor Escape with Keep editing; tile menu, Move, and Delete (focus order, Escape, focus returns to the tile's menu button, Cancel is the focused default in Delete); search (Tab leaves the search box into results, the hidden grid is inert); Settings and Lock now, then unlocking by keyboard; the backup import dialog; and a full page focus order with no trap.
- Reduced motion: with `prefers-reduced-motion: reduce` no element has a nonzero transition or animation duration, including hovered controls and dialogs. A control run shows the same page does transition without the preference.
- Contrast: `tests/contrast.test.ts` recomputes WCAG ratios from the tokens for both themes, including the tile hover blend and the decorative border.

### Defects found and fixed

| # | Found by | Defect | Fix |
| --- | --- | --- | --- |
| 1 | keyboard walkthrough (failed first) | After Keep editing on the unsaved-changes prompt the focused button unmounted and focus fell to the page instead of the note | Focus returns to the note body (`useNoteDraft.answerConfirm`); unit assertion added and verified failing without the fix |
| 2 | keyboard walkthrough of Settings (failed first) | When a named radio group was the last Tab stop in a dialog, the wrap-around compared against the last radio, so Tab left the dialog | The dialog's Tab handling counts a radio group as one stop; two unit tests, one verified failing without the fix |
| 3 | design brief review | The brief and Task 1 require System, Light, and Dark selection, but nothing in the UI changed the theme (the provider's setter was unused) | A Theme section in Settings (radio group); unit tests and the journey asserts a persisted explicit choice |
| 4 | screenshots | Native radios and checkboxes rendered in the browser's default blue, off the palette | `accent-color: var(--action)`; a test fails without it in both themes |

Not defects (recorded so they are not rediscovered): an axe contrast report on the unsaved-changes prompt in dark was the 120 ms hover fade sampled mid-blend; the scan now waits for transitions to finish, and reduced motion removes them. The Move dialog is unaffected by defect 2 because buttons follow its radio group.

### Manual checks NOT performed (need a person and a real device)

Not run by me, because they need hardware or assistive technology this environment does not have:

- [ ] Screen reader announcements with VoiceOver (iOS and macOS), TalkBack (Android), and NVDA or JAWS (Windows): "Saved", "Copied", result counts, "Secret hidden", the update and offline notices, dialog titles on open, and that secret content is never spoken in a tile, in search results, or in a status.
- [ ] A real phone's software keyboard: the editor's Save and Cancel stay reachable above the keyboard on iOS Safari and Android Chrome; the secret editor does not show autofill or spelling suggestions of the token; the keyboard does not cover the focused field.
- [ ] IME composition (Japanese, Chinese, Korean): Enter and Escape during composition do not save or close, and Ctrl+Enter saves only after composition ends. A unit test covers the event shape, not a real IME.
- [ ] Real browser zoom to 200% and 400% and operating-system text enlargement (iOS Dynamic Type, Android font size, Windows text scaling): no clipped or unreachable controls.
- [ ] Reduced motion set in the operating system on a real device.
- [ ] Touch target feel and one-handed reach on a real phone.
- [ ] Hiding the secret when switching apps or locking the phone, and the 60 second hidden-tab lock, on a real phone.
- [ ] Installing as an app from HTTPS on a phone and a desktop, then opening it offline.
- [ ] Firefox: the whole browser suite and a hand check.
- [ ] Safari itself (the tests used the Playwright WebKit port), including storage behavior under Safari's intelligent tracking rules for sites not used for seven days.

## Visual review

Screenshots (light and dark, 1280 px and 360 px) are in `docs/verification-screenshots/`, named `<theme>-<size>-<number>-<screen>.png`: empty, home, collection, revealed secret, search results, search with no results, Settings, editor, and an editor with a failed save. They are a review artifact, not snapshots to diff. Regenerate with `CAPTURE_SCREENSHOTS=1 npx playwright test screenshots --project=chromium`. All notes are synthetic.

Evaluation against the design brief, from those images (a reading by the implementer, not a design review by a designer):

- **B layout, big colored tiles.** Matches. Collections are large tinted tiles (Sage, Clay, Ochre, Slate) with a folder icon, a title, and an item count; notes are neutral tiles with a note icon, title, and two-line preview; a secret tile shows a lock and eight dots. Three columns at 1280 px and one column at 360 px; no sidebar.
- **Restrained typography.** Matches. Source Serif 4 appears only in the Scratch wordmark; Source Sans 3 is used for everything else at modest sizes; headings are not oversized; monospace appears only in the revealed secret.
- **Color.** Matches. Warm paper neutrals with an olive action color in light, and a dark theme with the same hue family. No purple, no gradients, no glass or decoration.
- **Both themes cover every state.** Every state captured, every dialog, and the error and empty states render legibly in both themes; axe finds no contrast violation.
- **Deviations noted, none changed (style opinion rather than a clear brief violation):**
  1. The browser's native clear button inside the search box renders in the browser's own blue in Chromium. It is a small control and not trivially themable.
  2. The first-visit "Scratch is ready to work offline." notice floats over the top of the page for about six seconds, covering the wordmark and, on a 360 px phone, the Add button's label. It ignores pointer input, so taps still reach what is underneath, and it clears on the first key press; but a person may still see Add obscured on first install.
  3. The neutral card border is faint (about 1.3:1 on the page in light). The brief calls borders decorative, controls carry a 3:1 focus-colored boundary, and a test pins that distinction.

## Performance measurements

Measured in desktop Chromium 153 on the machine above, against the production build served by `vite preview`, with Playwright driving the page. These are **desktop numbers**. **No phone was measured**, and a phone, which will be several times slower at the key derivation, is on the manual list below.

Reproduce: `MEASURE=1 npx vitest run tests/measure` (writes a 1,000-item encrypted backup and times search in Node), then `MEASURE=1 npx playwright test measure --project=chromium --workers=1` (times the browser, writes `measure-output/browser.json`). The 1,000 items are 20 collections and 980 short notes, every tenth a Secret note, built with the real vault and imported through the real import screen.

| Measure | Target in the brief | Measured | Verdict |
| --- | --- | --- | --- |
| Unlock, 600,000 PBKDF2 iterations (click Unlock to the library on screen) | no target; measure and never lower the count | median 84.8 ms, min 84.2, max 86.2, 7 runs | measured; count unchanged at 600,000 |
| Import of the 1,000-item backup, setup screen to library on screen | none | 440 ms wall clock, one run, Playwright round trips included | measured |
| Warm navigation, 1,000 items (open a collection of 49 items, press Back) | under 100 ms | median 31.2 ms, p95 33.3, max 33.3, 40 navigations | within target. The figure is the time to two painted frames, so it is bounded below by about 33 ms at 60 Hz; the work itself is under one frame |
| Search results, 1,000 items, from typing, 150 ms debounce included | within 250 ms after the debounce | per query, median after the debounce: "river" (247 results) 32 ms; a phrase (47) 24.5 ms; no match 17.5 ms; "Key 4" (19) 22 ms; "a" (938 results) 95.5 ms. Slowest single run 98.5 ms after the debounce | within target |
| Search in Node, index build (1,000 items) | none | median 15.0 ms, max 21.9 ms over 15 builds | measured |
| Search in Node, one query | none | 0.02 to 0.12 ms median | measured |
| Initial JavaScript, gzip | at or below 200 KiB | 126.6 KiB (index chunk, 129,630 bytes, gzip level 6) plus 0.5 KiB for `theme-init.js`; a separate 2.1 KiB worker-registration chunk; total 129.2 KiB | within target |
| CSS, gzip | none | 4.3 KiB | measured |
| Fonts | measured separately | 20 woff2 files, 244 KB on disk, loaded per subset as needed | measured |

No budget failed, so no loading path was split or simplified, and no virtualization was added. The 938-result case is the slowest because it paints the most tiles.

Not measured: anything on a real phone, any non-Chromium browser, a cold first load over a real network, memory use, and battery.

### Measurements still needed on a real phone (manual)

- [ ] Unlock time with the 600,000-iteration derivation on a mid-range and a low-end phone, in the browser and installed. If it feels slow, show or tune the Unlocking state; do not lower the count.
- [ ] Warm navigation and search with 1,000 items on the same phones.
- [ ] Time to first interaction on a cold first visit over a typical mobile connection.

## Content Security Policy

`public/_headers` carries the policy (see the README). `npm run preview` applies it, so the entire browser suite runs under it, and `csp.spec.ts` fails on any `securitypolicyviolation` event or policy console message while it creates a library, saves notes, reveals a secret, moves, searches, exports, opens the import dialog, switches theme, reloads, and unlocks, with the service worker installed. Controls in that test confirm an inline script and an inline `style` attribute are refused and a cross-origin request is blocked, so an empty violation list is not a blind spot. `tests/csp.test.ts` fails if any directive is weakened, `unsafe-inline`, `unsafe-eval`, wildcards, `data:`, `blob:`, or another origin appear, or an inline script or style attribute is added to `index.html`. WebKit passes the same test. Not verified: Firefox, and a real host applying the file (nothing is deployed).

## Honesty notes

- Everything above ran on one Windows machine. Phones, Safari proper, Firefox, screen readers, and IMEs were not exercised.
- Passing automated checks does not establish visual quality or phone-keyboard usability; the manual lists above are the remaining gate.
