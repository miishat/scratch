# Scratch

Scratch keeps short notes, such as API tokens, snippets, and reminders, in one place. Notes are stored encrypted in your own browser. There is no account, no server, and no sync. It is a static web app that also works offline once it has loaded.

Verification evidence, measured numbers, and the checks that still need a person on a real device are in [docs/verification.md](docs/verification.md). The storage and backup format is in [docs/storage-format.md](docs/storage-format.md).

## Local development

Requires Node 22.12 or newer.

```
npm ci
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server. The service worker and the Content Security Policy only exist in the production build. |
| `npm test` | Unit and component tests (Vitest, jsdom, real Web Crypto, fake-indexeddb). |
| `npm run typecheck`, `npm run lint` | TypeScript and ESLint. |
| `npm run build` | Type check, then the production build into `dist/`. |
| `npm run preview` | Serves `dist/` with the security headers from `public/_headers`. |
| `npm run test:e2e` | Builds, then runs the browser tests (Playwright) against the production preview. |

Install the test browsers once with `npx playwright install chromium webkit firefox`. The browser tests run on desktop Chromium and WebKit, and on phone-sized Chromium and WebKit emulation (360 px wide). Firefox runs too when it can start on the machine; if it cannot, its project is left out with a warning. Set `REQUIRE_FIREFOX=1` to make the run fail instead. Two opt-in runs write review artifacts: `CAPTURE_SCREENSHOTS=1` regenerates `docs/verification-screenshots/`, and `MEASURE=1` times unlock, navigation, and search (docs/verification.md has the two-step command).

## Using Scratch

- **Passphrase.** The first visit asks you to create a passphrase. It protects every note. It is never stored, and it cannot be recovered. If you forget it, the notes in that browser cannot be opened by anyone, including you. Keep a backup and remember which passphrase goes with it.
- **Locking.** Scratch locks when the page is reloaded, after ten minutes without activity, or after the tab has been hidden for a minute. A note you were writing is kept encrypted in memory and comes back after you unlock. Locking applies to one tab at a time. If another tab replaces the library while you have an unsaved note, Scratch hides the library and offers Export backup, Keep editing, or Discard. If you step away at that point, it asks for your passphrase again before you can export or keep editing.
- **Secret notes.** A note can be marked Secret and given a title. Its body stays masked until you press Reveal, hides again after 30 seconds or when the tab is hidden, and is never shown in tiles or search results. A secret can be found by its title.
- **Theme.** Settings has System, Light, and Dark. System follows your device and changes with it. Only the choice is saved in the browser, and it is applied before the page first paints, so there is no flash. Your theme is not part of a backup.
- **No sync.** Notes live in one browser on one device. Another browser or device starts empty until you move a backup there.

## Backups: moving and replacing

- **Export backup** (Settings) downloads one encrypted `.scratch` file. It holds every note and collection. Titles, bodies, and colors are encrypted; the number of items and the folder structure are not hidden (see docs/storage-format.md).
- **Move to another browser or device.** Open Scratch there, choose Import backup on the first screen, pick the file, and enter the backup's passphrase. The imported library keeps that passphrase from then on.
- **Import backup in Settings replaces the library in this browser.** Everything stored here is removed and the backup's contents take its place. Nothing is merged. You see the item count and confirm first, and a failed import leaves the existing library untouched.
- **Old backups and passphrases.** A backup always needs the passphrase that was current when it was exported. If you change your passphrase later, an older backup still needs the old one. Export a fresh backup after changing it.
- **Backups are not automatic.** Browser data can disappear (see below), so export a backup from time to time and keep it somewhere safe. A backup holds your notes, so treat the file like the notes themselves.

## Browser data

Notes are kept in the browser's site storage for this address. Clearing site data or cookies for it, a private window that closes, removing the installed app on some platforms, or the browser evicting storage under pressure can delete the library without warning. Scratch asks the browser to keep its data, but that is a request. A different address (another host name, port, or sub-path) is a different, empty library, which is why a stable HTTPS address matters (below).

## Offline use and installing

- Scratch needs one online visit first. The first load downloads the app and stores it in the browser; after that it opens without a network. A browser that has never loaded Scratch cannot open it offline, and the first visit on a new device needs a connection.
- Installing Scratch as an app (the browser's Install, or Add to Home Screen on a phone) needs HTTPS. `http://localhost` also works for local testing. A plain `http://` address on another host cannot be installed and has no offline use, but notes still work there.
- On a phone: open the HTTPS address in the browser, then use Add to Home Screen or Install in the browser menu. On desktop Chrome or Edge, use the install icon in the address bar or the menu. Safari on a Mac uses File, then Add to Dock. Installed or not, the library lives in that browser's storage for the address.
- When a new version is available, Scratch asks before updating. If you have an unsaved note you can save it, discard it, or cancel and keep writing. Updating reloads the app, so you will unlock it again. If you approve an update in one tab, other open tabs are not reloaded: they keep running (so an unsaved note there is safe) and offer the same update, which reloads that tab when you choose it.
- The offline cache holds only the app files (page, scripts, styles, fonts, icons). It never holds notes, backups, or your passphrase.

## Production static hosting

Nothing is deployed from this repository, and deploying requires a separate, explicit decision. To host Scratch later:

1. Run `npm run build` and upload the contents of `dist/` to any static host that serves over HTTPS. No server code or database is needed.
2. **Choose a stable HTTPS origin and keep it.** The library, the service worker, and the installed app are all tied to the exact origin (scheme, host, and port). Changing the host name, or moving between a root and a sub-path, starts users with an empty library; a backup is the only way across.
3. **Sub-paths work.** The build uses relative paths, so `https://example.com/` and `https://example.com/notes/` both work from the same `dist/`. The offline cache and service worker scope follow the folder `index.html` is served from.
4. Serve `index.html`, `sw.js`, `theme-init.js`, and `manifest.webmanifest` without long-lived caching so browsers notice updates. Files under `assets/` have content hashes and can be cached for a year.
5. Apply the security headers below.

### Content Security Policy

`public/_headers` ships in `dist/` and holds the headers in the format Netlify and Cloudflare Pages read. It is preparation only. Other hosts need the same values in their own configuration. The policy:

```
default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self';
manifest-src 'self'; worker-src 'self'; connect-src 'self'; object-src 'none';
base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

plus `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. What it does and why the app still works:

- Scripts, styles, fonts, images, the manifest, and the worker must come from the same origin. There is no `unsafe-inline` or `unsafe-eval`, no other origin, and no `data:` or `blob:` source. Objects and framing are forbidden.
- The one small script that sets the theme before first paint is the same-origin file `theme-init.js`, not an inline script, so there is no hash to keep in sync with the build.
- `connect-src 'self'` exists because the service worker fetches the app's own files to cache them. The page makes no requests of its own after loading, and no other origin can be contacted.
- Inline `style` attributes written as markup would be blocked. Scratch has none: all CSS is in built files, and the few runtime values (such as indentation in the Move dialog and the color scheme) are set through the DOM's style API, which this policy does not restrict. The policy test fails if source starts writing style attributes as markup.
- `frame-ancestors` only works as a header, not in a `<meta>` tag, so a host that cannot set headers cannot enforce it.
- Equivalents: nginx `add_header Content-Security-Policy "..." always;`, Apache `Header always set Content-Security-Policy "..."`, Caddy `header Content-Security-Policy "..."`. Under a sub-path, set the headers for that sub-path.

`npm run preview` applies the same block from `public/_headers`, and `tests/e2e/csp.spec.ts` drives the whole app under it and fails on any violation. `tests/csp.test.ts` fails if the policy is weakened or an inline script appears in `index.html`.

## Resolved direct package versions

| Package | Version | Package | Version |
| --- | --- | --- | --- |
| react | 19.3.0 | react-dom | 19.3.0 |
| dexie | 4.4.6 | vite | 8.3.1 |
| typescript | 6.0.3 | @vitejs/plugin-react | 6.1.1 |
| vite-plugin-pwa | 1.3.0 | eslint | 10.11.0 |
| @eslint/js | 10.0.1 | typescript-eslint | 8.71.0 |
| eslint-plugin-react-hooks | 7.1.1 | vitest | 5.0.3 |
| jsdom | 29.1.1 | @testing-library/react | 16.3.3 |
| @testing-library/user-event | 14.6.7 | @testing-library/jest-dom | 7.0.1 |
| fake-indexeddb | 6.2.5 | @playwright/test | 1.63.0 |
| @axe-core/playwright (tests only) | 4.13.0 | @fontsource/source-sans-3 | 5.3.0 |
| @fontsource/source-serif-4 | 5.3.0 | @types/node | 26.6.3 |
| @types/react | 19.3.0 | @types/react-dom | 19.3.0 |

## Palette check

WCAG 2 contrast ratios measured for every primary and muted text token on the page, neutral surface, and four collection tint backgrounds; focus rings measured against those backgrounds. All normal text pairs exceed 4.5:1 and all focus rings exceed 3:1. Light: page text 13.36, muted 5.55, focus 5.14; surface 14.43, 6.00, 5.55; Sage 12.20, 5.07, 4.69; Clay 11.26, 4.68, 4.33; Ochre 11.90, 4.94, 4.57; Slate 11.78, 4.90, 4.53. Dark: page 14.68, 8.68, 9.61; surface 12.98, 7.68, 8.50; Sage 10.31, 6.10, 6.75; Clay 10.68, 6.32, 6.99; Ochre 10.33, 6.11, 6.76; Slate 10.82, 6.40, 7.08. Action text on fill: light 5.55, dark 8.76; action/focus against neutral surface: light 5.55, dark 8.50; against page: light 5.14, dark 9.61. No palette corrections were necessary. `tests/contrast.test.ts` recomputes these pairs, the hover blends, and the decorative border from `src/app/tokens.css` and `src/app/global.css`.

Fontsource bundles the font files locally in the build. Both font licenses are shipped in `public/licenses/`.
