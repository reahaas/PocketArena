# Phase 5 — Tests, Documentation & Deployment

**Status:** Complete (deployment and on-device acceptance outstanding)
**Depends on:** Phase 4
**Goal:** every item on the spec §47 acceptance checklist is ticked, the spec §39 manual multiplayer
script passes, and the game is live on real hosting.

Most tests should already exist from earlier phases. This phase closes the gaps, hardens the
adversarial paths, and ships.

---

## Tasks

### Complete the spec §38 test list

Confirm coverage exists for every item; write what is missing:

- [ ] room ID generation — charset, length, randomness, no sequential IDs
- [ ] invite URL generation and parsing — round-trip, malformed input
- [ ] joystick normalization, dead zone, diagonal normalization
- [ ] movement calculation, boundary clamping, frame-rate independence
- [ ] spawn positions — deterministic, non-overlapping
- [ ] network message validation, serialization/deserialization
- [ ] sequence numbers, prediction, reconciliation, interpolation
- [ ] scenario coverage at 2, 5, 10, and 20 players via `LoopbackHarness`
- [ ] simultaneous movement, join-while-running, player disconnect, host disconnect, full room
- [ ] malformed network messages

### Adversarial / security hardening (spec §34)

- [ ] Host message handler: `x = 999999` moves nobody; spoofed `playerId` cannot control another
      player; negative, duplicate, and wildly out-of-order `sequence` values are rejected;
      forged `timestamp` values do not affect the simulation
- [ ] Signaling server: oversized frames, message floods, unknown types, malformed JSON, and
      `joinRoom` on a non-existent room are all handled without crashing the process
- [ ] Confirm no secrets in the repo and none derivable from a room ID (spec §33)
- [ ] `npm audit` clean; dependency versions pinned

### Documentation

- [ ] Project `README.md`:
      - what the game is, and a 30-second quickstart
      - architecture diagram (signaling star for setup, host-and-spoke for gameplay)
      - all npm commands (spec §41)
      - `.env` reference
      - **known limitations, stated plainly:**
        - same-WiFi assumption / no TURN (decision **D3**)
        - host backgrounding risk on iOS (decision **D2**)
        - no reconnection — a refresh is a new player (decision **A4**)
        - no host migration
      - debug mode: `?debug=1`, `?bots=N`, latency/loss env vars
- [ ] Brief `CONTRIBUTING`-style note covering the architectural rules in `plan/README.md`

### Deployment (spec §43)

- [ ] Frontend: static hosting with an **SPA fallback rewrite for `/join/*`** — without this, links
      opened from WhatsApp 404, which breaks the core product flow
- [ ] Signaling: small Node service over **WSS**, in-memory rooms only, no database
- [ ] HTTPS everywhere — WebRTC and the Web Share API require a secure context in production
- [ ] Set production `VITE_SIGNALING_URL`; verify the origin allowlist matches the deployed domain
- [ ] Health check endpoint on the signaling service, and confirm it survives a restart with no
      persisted state (rooms are expected to be lost — that is by design)

### Final acceptance

- [ ] Walk the spec §39 manual multiplayer script end to end
- [ ] Tick every box in the spec §47 checklist
- [ ] `npm run build && npm run lint && npm run test` green
- [ ] No TODOs left for required functionality (spec §48)

## Exit criteria

- [ ] Deployed and reachable over HTTPS
- [ ] A link shared into a real WhatsApp group opens and joins successfully on iOS and Android
- [ ] The full §47 checklist passes
- [ ] Build, lint, and tests all pass from a clean clone (`rm -rf node_modules && npm ci`)

## Verification

```bash
npm ci
npm run build && npm run lint && npm run test
```

Then, against production:
1. Host on phone A → Create Game → Share to a WhatsApp group
2. Open the link on every available device; join
3. Move all players simultaneously; confirm responsiveness
4. Disconnect one player; confirm everyone else continues
5. Disconnect the host; confirm every client shows "Host disconnected"
6. Attempt a 21st join; confirm "Game is full"

## Risks / watch items

- **The SPA rewrite is the single most likely deployment mistake.** `/join/ABC123` must serve
  `index.html`. Test it on the deployed site, not just in the Vite dev server.
- Mixed content: an HTTPS page cannot open a `ws://` signaling socket. `VITE_SIGNALING_URL` must be
  `wss://` in production.
- Free-tier hosting that cold-starts or idles the signaling service will drop in-memory rooms and
  break games mid-session. Pick a platform that keeps the process warm.

## Deviations log

- 122 unit/integration tests across 11 files, plus 17 Playwright end-to-end tests.
  `npm audit` reports 0 vulnerabilities.
- The signaling service got a full integration suite over real WebSockets, including relay isolation
  between rooms, oversized frames, rate limiting and the origin allowlist.
- **Playwright added**, which closed the two-page verification gap. Two real browser pages now
  connect over real WebRTC and each one observes the other moving. Chromium must be launched with
  background throttling disabled or the host page stops simulating the moment the guest takes focus.
- **A `window.__pocketArena` test hook** was added to `App.runGame`, gated behind `?debug=1`. A test
  asserts it is absent without the flag.
- **Docker stack added**: an nginx-served client and the Node signaling service, with `/ws` proxied
  so everything is same-origin. `npm run test:e2e:docker` points the E2E suite at it, which is what
  actually exercises the nginx SPA rewrite rather than Vite's dev fallback.
- **A real race condition was found by the E2E suite** — see phase 2's log.
- **Outstanding, and all need something this environment cannot provide:**
  - Building the Docker images. Docker Hub is unreachable from this machine (only a private ACR is
    reachable), so `docker compose build` cannot pull `node:24-alpine` or `nginx:1.27-alpine`.
    `docker compose config` validates, but the images have never been built or run here.
  - Deploying to static hosting plus a WSS signaling service.
  - Walking the spec §39 manual script on phones, including opening the invite from a real WhatsApp
    message.
