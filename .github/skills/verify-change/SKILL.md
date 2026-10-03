---
name: verify-change
description: Run the full validation gate (typecheck, lint, unit tests, build, relevant e2e) for Pocket Arena and diagnose failures. Use before committing or when asked to verify a change.
---
# Verify a change

1. PowerShell: `$env:PATH = "C:\Program Files\nodejs;$env:PATH"`.
2. Run in order, stopping at the first failure and fixing the root cause:
   `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`.
3. For user-visible changes run the relevant e2e spec against the dev server:
   - start `npm run dev:all` (async, wait ~12s)
   - `$env:E2E_BASE_URL="http://localhost:5173"; npx playwright test e2e/<spec>`
   - stop the dev server by PID afterwards.
4. If e2e fails, read `test-results/**/error-context.md` first.
5. Do not edit tests to hide failures. Report what ran and the pass counts.

Known traps: see `docs/gotchas.md` (stale `dist` on port 8787, Playwright chromium install).
