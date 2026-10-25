# Live checks — Light tier

Evidence for each release. Every `.txt` file is raw command output with the commit it ran on in the first line.

- Run by: Claude Code (cloud session), 2026-10-12, Linux · Node 22 · Chromium 1194 (Playwright 1.56.1)
- Environment: local static servers. Lighthouse "A" runs have no gzip/brotli or cache headers; Vercel adds both, so the "B" runs (gzip + cache headers) are closer to production.

## v2.1 — `checks/2026-10-12-v2.1/` (commit `5d373a9`, branch `feat/v2.1-plan-tools`)

| # | Check | Command | File | Result |
|---|---|---|---|---|
| 1 | Unit tests: engine (custom order, yearly bonus, month in progress, flat-rate contracts, buyout), money, i18n key parity, storage, encrypted backups | `npm test` | [unit-tests.txt](2026-10-12-v2.1/unit-tests.txt) | 57 passed / 0 failed / 0 skipped |
| 2 | Deploy set on every page (app + 4 guides): syntax, references, zero third-party requests, no inline scripts, CSP parity, SW stamp | `npm run check` | [deploy-checks.txt](2026-10-12-v2.1/deploy-checks.txt) | all passed |
| 3 | Browser smoke + live checks (44 steps) | `npm run smoke` | [smoke.txt](2026-10-12-v2.1/smoke.txt) | 44 passed / 0 failed |
| 3a | ↳ monthly check-in logs 5 payments at once, freedom date holds, undo restores | smoke | smoke.txt | ok |
| 3b | ↳ encrypted backup: short passphrase refused, file holds no plaintext, wrong passphrase refused, right one restores | smoke | smoke.txt | ok |
| 3c | ↳ contract helper (4% flat, 60 months, 12 paid → 8,284.445 / 200 / 7.42%), buyout verdicts, custom order + focus, yearly bonus, goal ahead/on track | smoke | smoke.txt | ok |
| 3d | ↳ guides render, link back to the app, CTA opens the buyout calculator, available offline | smoke | smoke.txt | ok |
| 3e | ↳ axe-core: empty, dark, light/desktop, check-in sheet, buyout sheet, guide page | smoke | smoke.txt | 0 violations |
| 3f | ↳ offline, update path, export → wipe → import, XSS probe, CSP violations, console errors | smoke | smoke.txt | ok / none |
| 4 | Lighthouse: app mobile + desktop, a guide page; with and without compression | `lighthouse` 12.8.2 | [lighthouse.txt](2026-10-12-v2.1/lighthouse.txt) | A11y 100 · BP 100 · SEO 100 everywhere · Perf: app mobile 84 (A) / 95 (B), desktop 99, guide 95 (A) / 97 (B) |
| 5 | Secrets, working tree | `gitleaks detect --no-git` | [gitleaks-tree.txt](2026-10-12-v2.1/gitleaks-tree.txt) | 0 findings |
| 6 | Secrets, full history (14 commits) | `gitleaks detect` | [gitleaks-history.txt](2026-10-12-v2.1/gitleaks-history.txt) | 0 findings |

Screenshots (Chromium emulation, not device evidence): [check-in card](2026-10-12-v2.1/mobile-checkin-card.jpg) · [check-in sheet](2026-10-12-v2.1/checkin-sheet.jpg) · [contract helper](2026-10-12-v2.1/contract-helper.jpg) · [buyout calculator](2026-10-12-v2.1/buyout-calculator.jpg) · [guide page](2026-10-12-v2.1/guide-mobile-dark.jpg)

Mobile performance on the uncompressed server moved from 87 (v2) to 84: v2.1 ships more CSS and JavaScript. The story card and encryption modules now load on first use to keep the start-up graph small.

## v2.0 — `checks/2026-10-12/` (commit `0c5b3a4`, merged in PR #1)

| # | Check | Command | File | Result |
|---|---|---|---|---|
| 1 | Unit tests: engine, money (X Star §8 cases), i18n, storage | `npm test` | [unit-tests.txt](2026-10-12/unit-tests.txt) | 41 passed / 0 failed / 0 skipped |
| 2 | Deploy set: syntax, references, zero third-party requests, CSP parity, SW stamp | `npm run check` | [deploy-checks.txt](2026-10-12/deploy-checks.txt) | all passed |
| 3 | Browser smoke + live checks (32 steps) | `npm run smoke` | [smoke.txt](2026-10-12/smoke.txt) | 32 passed / 0 failed |
| 4 | Lighthouse mobile + desktop | `lighthouse` 12.8.2 | [lighthouse.txt](2026-10-12/lighthouse.txt) | A11y 100 · BP 100 · SEO 100 · Perf 87 mobile / 100 desktop |
| 5 | Secrets, working tree | `gitleaks detect --no-git` | [gitleaks-tree.txt](2026-10-12/gitleaks-tree.txt) | 0 findings |
| 6 | Secrets, full history | `gitleaks detect` | [gitleaks-history.txt](2026-10-12/gitleaks-history.txt) | 0 findings |
| 7 | Pre-commit hook blocks a planted fake AWS key | `.githooks/pre-commit` | (session log) | exit 1, 2 leaks found ✓ |

Screenshots: [mobile dark](2026-10-12/mobile-ar-dark.jpg) · [desktop light](2026-10-12/desktop-ar-light.jpg) · [form validation](2026-10-12/form-validation.jpg) · [debt details](2026-10-12/debt-details.jpg) · [never-ending plan](2026-10-12/never-ending-plan.jpg) · [print](2026-10-12/print-layout.jpg)

## Pending — need real devices (not done)

A row without a file is not done. These need a phone and a deployed URL:

| Check | Device | Status |
|---|---|---|
| RTL on a real phone | iPhone (Safari) + Android (Chrome) | not done |
| Add to Home Screen, both platforms (icon, name, standalone launch) | iPhone + Android | not done |
| Safe area: notch / Dynamic Island, portrait + landscape (dark hero under status bar) | iPhone 14+ | not done |
| Airplane mode on device after install (app and guides) | iPhone + Android | not done |
| WhatsApp / iMessage link preview shows the 1200×630 card (app and a guide) | phone | not done |
| Encrypted backup saved on one device restores on another | two devices | not done |
| Cross-browser spot check | desktop Safari / Chrome / Edge | not done |
| Production headers (CSP, HSTS, caching) on the deployed URL | `curl -I` | not done (production URL not reachable from this session) |
