# ADR 0001 — Modular static PWA (Light tier)

- Status: proposed (needs owner approval)
- Date: 2026-10-12
- Tier: Light (no accounts, no server-held user data, no money movement, no uploads, no admin, no sync)

## Context

v1 shipped as one HTML file with inline CSS/JS, loading Google Fonts and Chart.js from third-party CDNs. That made three things hard:

1. **Testing the payoff engine.** The rollover bug (freed minimums dropped after the payoff month) went unnoticed because the engine could not be imported by a test runner.
2. **A strict Content-Security-Policy.** Inline scripts/styles need `'unsafe-inline'` or hashes that change on every edit.
3. **The privacy promise.** Every visit contacted Google and Cloudflare, and a CDN outage removed the payment schedule (Chart.js threw before the table rendered).

## Decision

Keep the Light Lane A properties — static hosting, **zero runtime dependencies**, no build step — but split the app into same-origin ES modules (`assets/js/*.js`) and one stylesheet, and self-host fonts and icons.

- Pure modules (`engine`, `money`, `i18n`, `store` validation) are unit-tested with `node:test`.
- CSP is `script-src 'self'; style-src 'self'; connect-src 'self'` with no exceptions, served as a meta tag and as a header.
- The chart is a small dependency-free SVG module instead of Chart.js.
- The service worker's precache list and version are generated from file contents (`tools/stamp-sw.mjs`); CI fails if they are stale.
- Money is stored as integer fils (Light L6), with an in-place v1→v2 migration (L4).

## Consequences

- More files to serve (≈ 30). The module graph is fetched in parallel via `modulepreload`, and the service worker precaches everything for offline use.
- Contributors need Node 20+ only for tests and tooling; the shipped app still needs nothing.
- Playwright is a dev-only tool for the browser smoke suite and asset generation. It is never loaded by the app.
- If the product ever needs accounts, sync or server-side data, this ADR does not stretch to cover it. Per the build system it escalates to the Secure tier as a re-architecture.
