# Scratch

A local-first, encrypted short-note app in progress. This first slice establishes the responsive shell, theme system, browser support gate, and shared UI primitives. Note storage and editors are not implemented yet.

## Local commands

Requires Node 22.12 or newer. Run `npm ci`, then `npm run dev`. For checks, run `npm run test`, `npm run typecheck`, `npm run lint`, and `npm run build`. `npm run test:watch` starts interactive unit tests; `npm run test:e2e` builds the app and runs the browser tests against the production preview (not the dev server), because the service worker only exists in the build. Install the browser once with `npx playwright install chromium`.

## Offline use and installing

- Scratch needs one online visit first. The first load downloads the app and stores it in the browser; after that it opens without a network. A browser that has never loaded Scratch cannot open it offline.
- Installing Scratch as an app (the browser's Install or Add to Home Screen option) needs HTTPS. `http://localhost` also works for local testing; a plain `http://` address on another host does not support installing or offline use, but notes still work online there.
- Notes are stored in each browser on each device, encrypted, and do not sync. To move a library to another browser or device, use Export backup, then Import backup there.
- When a new version is available, Scratch asks before updating. If you have an unsaved note you can save it, discard it, or cancel and keep writing. Updating reloads the app, so you will unlock it again.
- The offline cache holds only the app files (page, scripts, styles, fonts, icons). It never holds notes, backups, or your passphrase.

## Deploying to a static host

Run `npm run build` and upload the contents of `dist/` to any static host that serves over HTTPS. The build uses relative paths, so it works at a site root or under a sub-path. No server code or database is needed. Serve `sw.js` and `index.html` without long-lived caching headers so browsers see updates promptly; hashed files under `assets/` can be cached for a long time.

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
| @fontsource/source-sans-3 | 5.3.0 | @fontsource/source-serif-4 | 5.3.0 |
| @types/node | 26.6.3 | @types/react | 19.3.0 |
| @types/react-dom | 19.3.0 | | |

## Palette check

WCAG 2 contrast ratios measured for every primary and muted text token on the page, neutral surface, and four collection tint backgrounds; focus rings measured against those backgrounds. All normal text pairs exceed 4.5:1 and all focus rings exceed 3:1. Light: page text 13.36, muted 5.55, focus 5.14; surface 14.43, 6.00, 5.55; Sage 12.20, 5.07, 4.69; Clay 11.26, 4.68, 4.33; Ochre 11.90, 4.94, 4.57; Slate 11.78, 4.90, 4.53. Dark: page 14.68, 8.68, 9.61; surface 12.98, 7.68, 8.50; Sage 10.31, 6.10, 6.75; Clay 10.68, 6.32, 6.99; Ochre 10.33, 6.11, 6.76; Slate 10.82, 6.40, 7.08. Action text on fill: light 5.55, dark 8.76; action/focus against neutral surface: light 5.55, dark 8.50; against page: light 5.14, dark 9.61. No palette corrections were necessary.

Fontsource bundles the font files locally in the build. Both font licenses are shipped in `public/licenses/`.
