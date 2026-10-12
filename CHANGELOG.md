# Changelog

## v2.0.0 — demo-ready redesign (2026-10-12)

### Fixed
- Payoff engine: a cleared debt's minimum now keeps rolling to the next target every month. v1 dropped it after the payoff month, so plans ran months long (sample: 39 → 31 months) and paying a debt early could push the freedom date *later*.
- Never-ending plans stop after a year without progress instead of simulating 50 years. No more billion-dinar interest figures; the app shows the extra payment needed to finish, and a 5-year option.
- A corrupt or hand-edited backup could permanently break the app (unknown language). Backups are now fully validated and unknown settings fall back safely.
- The payment schedule disappeared when Chart.js failed to load. The chart is now built in and has no network dependency.
- Add-debt form rejected invalid input silently; it now shows inline errors, submits on Enter and accepts Arabic-Indic digits (٠-٩).
- Arabic grammar for counts (شهر واحد، شهرين، 3 أشهر، 11 شهراً) and durations (سنتين و7 أشهر).
- Numbers: Latin digits everywhere, so `17,000.000` can no longer be read as 17 million.
- Contrast: primary buttons and every text token meet WCAG AA in both themes.

### Added
- New design system and product identity (icon, dark hero, light/dark/auto themes), onboarding, and one-tap sample data for demos.
- Live strategy comparison with savings verdict, extra-payment slider, one-time payment, rollover toggle.
- Per-debt order, target, payoff date, payment history with undo, delete with undo, celebration on payoff.
- Interactive SVG chart, freedom milestones, year-grouped schedule, print/PDF layout.
- Islamic-finance terminology, debt-to-income meter, GCC currencies.
- Story card without amounts, monthly calendar reminder (.ics), install prompt / iOS hint.

### Security, privacy, PWA
- Zero third-party requests: self-hosted IBM Plex Sans Arabic and Lucide icons.
- Strict CSP (meta + header), HSTS, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `X-Frame-Options`.
- Offline app shell with a content-hashed service worker and a "new version" prompt.
- Money stored as integer fils with an automatic v1 → v2 data migration.
- Full SEO/OG set: description, canonical, 1200×630 share image, robots, sitemap, llms.txt.

### Tooling
- Unit tests (`node:test`), deploy checks, browser smoke suite, asset generator, CI (quality-gate, e2e-smoke, secrets-history, build), gitleaks pre-commit hook.
