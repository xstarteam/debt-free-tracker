## Scope
- Phase / task: <Phase N task X | feat slug | one-pager line>
- Session note: `docs/sessions/<file>.md`
- Preview URL: <Vercel preview link>

## What changed (one line per checkpoint commit)
- <sha7> — <what>

## Scope check
- [ ] Files changed match the phase task list / one-pager — nothing from the next phase
- [ ] No new dependencies, or each one named below with version + reason (G11 / L3)
- [ ] No new `NEXT_PUBLIC_*` variable, or each one justified below (G2 / L1)

## Evidence (links to raw output files — no summaries)
| Check | Result | File / CI artifact |
|---|---|---|
| quality-gate | green / red | `docs/sessions/evidence/<session>/quality-gate.txt` |
| unit-coverage | <NN>% | `.../unit-coverage.txt` |
| security-suite | <passed>/<total> · <denials> denials | `.../security-suite.txt` |
| e2e-smoke | green / red | `.../e2e-smoke.txt` |
| secrets (tree + history) | 0 findings | `.../gitleaks-*.txt` |
| build | green / red | `.../build.txt` |
| Light only — Live Checks | list checks + device | `.../live-checks/` |

## Guardian pass (Secure Phase 1 & 3 only)
<paste severity table 🔴/🟡/🟢 — 🔴 blocks, 🟡 needs a written decision below>

## Decisions
- <decision> — why

## Reviewer comments (Codex)
- [ ] All comments resolved with a commit or answered with a reason

## Approval
- [ ] Gate approved in writing by @bowaleed (G7)
