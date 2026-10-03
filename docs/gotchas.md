# Gotchas

Append an entry whenever something cost real time. Format: symptom -> cause -> fix.

- **`node`/`npm` not found (Windows PowerShell)** -> Node not on PATH -> `$env:PATH = "C:\Program Files\nodejs;$env:PATH"`.
- **Playwright fails with MIME-type/asset errors on port 8787** -> `npm run serve` serves a stale or missing `dist/` -> run e2e against the Vite dev server (`E2E_BASE_URL=http://localhost:5173`) or rebuild first.
- **Playwright "browser not found"** -> `npx playwright install chromium`.
- **Saved plays disappear after a validator change** -> `parsePlay` drops anything that fails validation (e.g. new min step duration) -> clamp/migrate instead of rejecting, and test with an old-format fixture.
- **Practice countdown e2e flake** -> the "3" frame can be missed; assert on "GO!" instead.
- **Video capture/share** is untested on real phones (Safari may lack `captureStream`); the code falls back to score-only.
- **LF/CRLF warnings on Windows commits** are harmless.
- **Host tab backgrounding** pauses the simulation; see `plan/decisions.md` D2.
