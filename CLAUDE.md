# محرر الديون (Debt Free) — CLAUDE.md

## Stack profile
- Product: محرر الديون — Debt Free · Live URL: https://debt-free-tracker-phi.vercel.app/
- Tier: Light · Lane: A (zero runtime dependencies, no build step; same-origin ES modules per ADR 0001) · Playbook: Light v1.2.3
- Template used: one-pager (not in the repo yet; see Scope contract)
- Tech Standard: v1.2.3 · Guardian: n/a (Light)
- Runtime: static HTML/CSS/ES modules, no framework · DB: IndexedDB on the user's device, nothing server-side · Host: Vercel static (headers in `vercel.json`)
- Repo: github.com/xstarteam/debt-free-tracker · Default branch: main (protection: verify) · Git identity: xstarteam / info@xstarkw.com
- Domain: debt-free-tracker-phi.vercel.app (no custom domain yet) · DNS owner: n/a
- Languages: ar (RTL, default) + en · Currency: KWD (+ SAR, AED, QAR, BHD, OMR, USD), integer minor units (fils) in storage
- Map: README.md § Architecture · decisions in docs/adr/ · evidence in checks/

## Scope contract
No one-pager in the repo yet; the owner adds it. Until then:
- Shipped: v2 (PR #1, merged 2026-10-12). In review: v2.1 (`feat/v2.1-plan-tools`).
- Next scope: only parking-lot items the owner approves in writing (latest note in docs/sessions/).
- Tier routing (all "no" → Light): accounts · server-held user data · money movement · uploads · admin · sync.
  Any "yes" → stop and escalate to Secure (xstar-build-system §6); never bolt it on.

## Guardrails (verbatim from playbook — do not edit here)
PENDING: copy L1–L9 byte-identical from the Light Playbook v1.2.3 file. It was not available in
the session that created this file, so the rule text was not reconstructed.
Index only (names, from xstar-build-system §3): L1 no secrets in client code ever · L2 never render
user input as HTML · L3 zero runtime external deps (Lane A) / SRI+justify (Lane B) · L4 never break
stored data (version bump + migration) · L5 export before asked (data lifeboat) · L6 money = integer
fils · L7 never fabricate output · L8 never bolt server features onto static architecture · L9 no open
compute (any anonymously invokable endpoint carries bot protection, or the feature escalates per §6).

## Commands
- Install: none — the app has no dependencies. Dev-only tools: `npm i -g playwright@1.56.1 axe-core@4.10.2`, gitleaks 8.21.2
- Dev: `npm run serve` → http://localhost:8080 (modules and the service worker need http, not file://)
- DB reset + seed: n/a — data lives in the browser; demo data is the «جرّب ببيانات تجريبية» button
- Quality gate: `npm run check` (syntax, references, zero third-party requests, CSP parity, sw.js stamp)
- Unit + coverage: `npm test` (engine, money, i18n, storage, vault; coverage not measured)
- Security suite: n/a (Light) — the XSS probe and CSP checks run inside the smoke suite
- E2E smoke: `PLAYWRIGHT_MODULE="$(npm root -g)/playwright" AXE_PATH="$(npm root -g)/axe-core/axe.min.js" npm run smoke`
- Secrets scan (tree + history): `gitleaks detect --no-git` / `gitleaks detect`
- Build: none — after changing any shipped file run `npm run stamp` (CI fails on a stale sw.js)
- Hooks: `git config core.hooksPath .githooks` once per clone (needs gitleaks on PATH)

## Session protocol
- Follow `agent-session-protocol`: start ritual → plan → scope lock →
  checkpoint commits → evidence → handoff note.
- Handoff notes: docs/sessions/ · Evidence: checks/<date>/ (Light layout, xstar-test-evidence §7)
- Never bypass hooks, lower thresholds, skip tests, or add dependencies
  without approval.

## Current state
- Phase: Light build — v2 live on main; v2.1 in review · Last gate approved: 2026-10-12 (PR #1, owner)
- Open drift / parking lot: see latest docs/sessions/ note
