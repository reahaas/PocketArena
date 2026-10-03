# AGENTS.md

Pocket Arena: mobile-first browser multiplayer arena. Host-authoritative WebRTC P2P (up to 20 players), tiny WebSocket signaling server, plus an offline coach **Playbook** feature (editor, solo practice, video share). TypeScript, Phaser, Vite, Vitest, Playwright.

This repo is developed almost entirely by AI agents. This file is the single source of truth for them; `.github/copilot-instructions.md` and any tool-specific files just point here. Keep it short and accurate: **if you learn something non-obvious or change a convention, update this file or `docs/` in the same change.**

## Commands

Node may not be on PATH on Windows: `$env:PATH = "C:\Program Files\nodejs;$env:PATH"`.

| Goal | Command |
| --- | --- |
| Full gate (run before every commit) | `npm run typecheck; npm run lint; npm run test; npm run build` |
| Unit tests only | `npm run test` (Vitest, `tests/`) |
| One e2e spec | `$env:E2E_BASE_URL="http://localhost:5173"; npx playwright test e2e/<file>` with `npm run dev:all` running |
| Dev (client + signaling) | `npm run dev:all` -> http://localhost:5173 |

Do not run e2e against the default port 8787 unless `dist/` was just built (stale `dist` gives MIME-type failures). Full e2e: `npm run test:e2e`.

## Map

- `src/game/` pure simulation (`GameSimulation`, `stepPlayer`) + Phaser rendering. `PlaybookMath`, `PlaybookPractice` hold playbook logic.
- `src/networking/` protocol/validation (`NetworkProtocol.ts`), host, client, prediction, transport.
- `src/ui/` DOM panes/overlays (helpers in `dom.ts`). `src/app/App.ts` wires everything (large; playbook flow is `runPlaybookStudio`).
- `src/storage/` localStorage persistence. `src/config/constants.ts` every tunable. `server/` signaling.
- `tests/` Vitest, `e2e/` Playwright, `plan/` historical design docs, `docs/` living knowledge (see below).

## Rules (enforced or load-bearing)

1. **Host is authoritative.** Clients send input, never position. Movement lives only in `stepPlayer()`.
2. `src/game/GameSimulation.ts` must not import Phaser, DOM, or WebRTC (ESLint enforces).
3. **No magic numbers**: new tunables go in `src/config/constants.ts`.
4. **Everything from storage, network, import or file is untrusted**: validate in `NetworkProtocol.ts` parsers (`parsePlay`, `parseDraft`, `parseStep`). Tightening a validator can silently drop users' saved data: add a migration or clamp, and a test.
5. **Playbook is offline** and independent of rooms. Its editor must not depend on a live game/room, and the joystick is disabled while editing.
6. A step's `durationMs` must be >= `minimumPlaybookStepDurationMs(from, to)`.
7. Practice/grading share `expectedPlaybookPosition` so renderer and scoring cannot disagree.
8. No secrets in code or commits. Config goes through env vars (`.env.example`).

## Workflow

- Small, surgical changes; no unrelated refactors. Match existing style; comment only non-obvious code.
- Every behavior change ships with tests (unit in `tests/`; user-visible flows get an `e2e/` spec). Bug fix = failing test first.
- Run the full gate before committing; fix root causes, do not skip/disable tests or lint.
- UI changes: verify in a browser via Playwright (mobile viewport matters); typecheck passing is not proof.
- Commit directly to `main` is the current practice. **Pushing `main` auto-deploys the client to GitHub Pages** (`.github/workflows/deploy-pages.yml`); the signaling server deploys via Render (`render.yaml`). Treat every push as a release.
- Commit style: imperative subject, short body. End with `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` when Copilot authored it.
- Update `README.md` and `docs/` when commands, architecture, or user-facing behavior change.

## Skills (`.github/skills/`)

- `verify-change`: the validation gate and how to debug failures.
- `add-playbook-feature`: touch-points checklist for playbook work.
- `add-network-message`: adding/validating a protocol message safely.
- `ship-change`: commit and push.
- `deploy`: GitHub Pages + Render release, verification, first-time setup, troubleshooting.

## Knowledge (`docs/`)

- `docs/architecture.md`: runtime model, data flow, module boundaries.
- `docs/playbook.md`: playbook data model, editor/practice/scoring behavior.
- `docs/gotchas.md`: hard-won pitfalls. **Append here whenever you lose time to something surprising.**
- `docs/decisions.md`: index of decisions (original rationale is in `plan/decisions.md`).
