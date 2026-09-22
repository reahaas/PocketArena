# Phase 0 — Scaffold

**Status:** Complete
**Depends on:** nothing
**Goal:** an empty but correctly structured project where `build`, `lint`, and `test` all pass.

Resist the urge to write gameplay here. The point of this phase is that every later phase drops
into a structure that already matches spec §36, with a config module that already exists so no
magic numbers ever get written.

---

## Tasks

- [ ] Initialise Vite + TypeScript project, npm as package manager (spec §35)
- [ ] `tsconfig.json` with `strict: true`, plus `noUncheckedIndexedAccess`,
      `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`
- [ ] Add Phaser 3 as a dependency — but do **not** import it outside `src/game/` [parallel]
- [ ] Add Vitest + ESLint flat config + `concurrently` as dev dependencies [parallel]
- [ ] Create the full folder skeleton from spec §36, plus `src/networking/transport/`
- [ ] Write `src/config/config.ts` containing every constant from `decisions.md` §3
- [ ] Write `.env.example` (see below); add `.env` to `.gitignore`
- [ ] Add npm scripts (see below)
- [ ] Add a placeholder test so `npm run test` exits 0 rather than erroring on "no tests found"
- [ ] Set up `server/` as a separate `tsconfig` target (Node, not DOM libs) so browser globals
      cannot leak into the signaling server

## Files created

```
package.json
tsconfig.json                 # browser/client
tsconfig.server.json          # node/server
vite.config.ts
vitest.config.ts
eslint.config.js
.env.example
.gitignore
index.html
src/main.ts
src/config/config.ts
src/{game,input,networking,networking/transport,room,ui,utils}/.gitkeep
server/index.ts
tests/.gitkeep
```

## npm scripts (spec §41)

```
dev         vite
dev:server  tsx watch server/index.ts
dev:all     concurrently -n web,sig -c cyan,magenta "npm:dev" "npm:dev:server"
build       tsc -b && vite build
lint        eslint .
test        vitest run
```

`dev:all` must work on macOS, Linux, and Windows — hence `concurrently` rather than `&`.

## `.env.example` (spec §42)

```
VITE_SIGNALING_URL=ws://localhost:8787
VITE_STUN_SERVERS=stun:stun.l.google.com:19302
VITE_TURN_URL=
VITE_TURN_USERNAME=
VITE_TURN_CREDENTIAL=
VITE_DEBUG_NETWORK_LATENCY_MS=0
VITE_DEBUG_PACKET_LOSS_PERCENT=0
SERVER_PORT=8787
```

No secrets committed. Production requires HTTPS + WSS because WebRTC needs a secure context.

## Exit criteria

- [ ] `npm install && npm run build && npm run lint && npm run test` — all green
- [ ] `npm run dev:all` starts both the Vite dev server and a Node process without errors
- [ ] `src/config/config.ts` exports every constant listed in `decisions.md` §3
- [ ] Folder layout matches spec §36
- [ ] Importing `phaser` from `src/networking/` or `src/config/` fails lint (enforced by an ESLint
      `no-restricted-imports` rule — this is what keeps spec §37 honest for the rest of the project)

## Verification

```bash
npm install
npm run build && npm run lint && npm run test
npm run dev:all   # confirm both processes come up, then ctrl-C
```

## Risks / watch items

- **Phaser bundle size** (~1 MB gzipped) works against "playing within seconds" (spec §45).
  Configure the dynamic import boundary now: `src/game/` should be lazily imported so the Home and
  Join screens paint before Phaser downloads. Cheap now, painful to retrofit.
- Getting the dual-tsconfig setup right up front avoids the common failure where `server/` code
  compiles against DOM types and then explodes at runtime in Node.

## Deviations log

- **No project references / `tsc -b`.** Composite projects may not disable emit, which fights
  `noEmit`. Replaced with three independent projects (`tsconfig.json`, `tsconfig.server.json`,
  `tsconfig.tools.json`) run in sequence by `npm run typecheck`.
- **Constants split in two.** `src/config/constants.ts` is environment-free so the Node signaling
  server can import it; `src/config/config.ts` adds the `import.meta.env` values for the browser.
- **`WS_MSG_MAX_BYTES` raised to 16 KB** from the planned 4 KB. An SDP offer does not fit in 4 KB.
- **vite 7 / vitest 4** rather than the first versions tried; vitest 2.x pulled an esbuild with a
  published advisory. `npm audit` is clean.
- `@eslint/js` had to be added explicitly as a devDependency.
