---
applyTo: "tests/**,e2e/**"
---
- Vitest for logic (`tests/`), Playwright for flows (`e2e/`). Prefer deterministic tests; avoid sleeps except where real time is the behavior under test.
- Run e2e against the Vite dev server (`E2E_BASE_URL=http://localhost:5173`).
- Never weaken an assertion to make a test pass; fix the cause.
