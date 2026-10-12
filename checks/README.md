# Live checks — Light tier

Evidence for the demo-ready redesign. Every `.txt` file is raw command output with the commit it ran on in the first line.

- Commit under test: `0c5b3a4b6cdfedb2ab8c8b78c7087d56846be57d` (branch `feat/demo-ready-redesign`)
- Run by: Claude Code (cloud session), 2026-10-12, Linux · Node 22 · Chromium 1194 (Playwright 1.56.1)
- Environment: local static server. Lighthouse ran without gzip/brotli or cache headers; Vercel adds both.

## Automated (this session)

| # | Check | Command | File | Result |
|---|---|---|---|---|
| 1 | Unit tests: engine, money (X Star §8 cases), i18n, storage | `npm test` | [unit-tests.txt](2026-10-12/unit-tests.txt) | 41 passed / 0 failed / 0 skipped |
| 2 | Deploy set: syntax, references, zero third-party requests, CSP parity, SW stamp | `npm run check` | [deploy-checks.txt](2026-10-12/deploy-checks.txt) | all passed |
| 3 | Browser smoke + live checks (32 steps) | `npm run smoke` | [smoke.txt](2026-10-12/smoke.txt) | 32 passed / 0 failed |
| 3a | ↳ airplane mode: loads offline after first visit, fonts included | smoke | smoke.txt | ok |
| 3b | ↳ persistence across reload (IndexedDB) | smoke | smoke.txt | ok |
| 3c | ↳ export → wipe → import round-trip | smoke | smoke.txt | ok |
| 3d | ↳ update path (deploy twice → prompt → reload) | smoke | smoke.txt | ok |
| 3e | ↳ XSS probe on every text input path (name rendered as text) | smoke | smoke.txt | not executed ✓ |
| 3f | ↳ accessibility scan, axe-core (empty, dark, light/desktop) | smoke | smoke.txt | 0 violations |
| 3g | ↳ CSP violations, page and console errors | smoke | smoke.txt | none |
| 4 | Lighthouse mobile + desktop | `lighthouse` 12.8.2 | [lighthouse.txt](2026-10-12/lighthouse.txt) | A11y 100 · BP 100 · SEO 100 · Perf 87 mobile / 100 desktop |
| 5 | Secrets, working tree | `gitleaks detect --no-git` | [gitleaks-tree.txt](2026-10-12/gitleaks-tree.txt) | 0 findings |
| 6 | Secrets, full history | `gitleaks detect` | [gitleaks-history.txt](2026-10-12/gitleaks-history.txt) | 0 findings |
| 7 | Pre-commit hook blocks a planted fake AWS key | `.githooks/pre-commit` | (session log) | exit 1, 2 leaks found ✓ |

Screenshots (Chromium emulation, not device evidence): [mobile dark](2026-10-12/mobile-ar-dark.jpg) · [desktop light](2026-10-12/desktop-ar-light.jpg) · [form validation](2026-10-12/form-validation.jpg) · [debt details](2026-10-12/debt-details.jpg) · [never-ending plan](2026-10-12/never-ending-plan.jpg) · [print](2026-10-12/print-layout.jpg)

## Pending — need real devices (not done)

A row without a file is not done. These need a phone and the Vercel preview URL:

| Check | Device | Status |
|---|---|---|
| RTL on a real phone | iPhone (Safari) + Android (Chrome) | not done |
| Add to Home Screen, both platforms (icon, name, standalone launch) | iPhone + Android | not done |
| Safe area: notch / Dynamic Island, portrait + landscape (dark hero under status bar) | iPhone 14+ | not done |
| Airplane mode on device after install | iPhone + Android | not done |
| WhatsApp / iMessage link preview shows the 1200×630 card | phone | not done |
| Cross-browser spot check | desktop Safari / Chrome / Edge | not done |
| Production headers (CSP, HSTS, caching) on the deployed URL | `curl -I` | not done (production URL not reachable from this session) |
