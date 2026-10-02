# Deployment

Scratch is a static site. `npm run build` writes it to `dist/`, and every path in
it is relative, so it works from a domain root or from a sub-path such as
`https://<user>.github.io/scratch/`.

## GitHub Pages

`.github/workflows/deploy.yml` runs on every push and pull request: typecheck,
lint, unit tests, and a production build. A push to `main` also publishes `dist/`
to GitHub Pages.

One-time setup in the repository on GitHub:

1. Settings, Pages, Build and deployment, Source: **GitHub Actions**.
2. Merge to `main` (or run the Deploy workflow by hand from the Actions tab).
3. The site appears at `https://miishat.github.io/scratch/`.

The browser (Playwright) suite is not part of the workflow because it builds and
serves the app and runs slowly. Run it locally with `npm run test:e2e` before a
release.

## Security headers

`public/_headers` holds the Content Security Policy and related headers. GitHub
Pages cannot send custom response headers, so it ignores that file: the app runs
there without the policy, and `frame-ancestors` cannot be set at all. Hosts that
read `_headers` apply it as written: Cloudflare Pages and Netlify can both deploy
straight from the same GitHub repository. Use one of them if the policy matters
for your deployment.
