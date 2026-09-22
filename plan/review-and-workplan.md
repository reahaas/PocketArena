# Review & Workplan

State of Pocket Arena after manual device QA, with everything still open and a plan to close it.

> **Update:** Steps 1, 2 and 4 are implemented. See §6 for what changed and what is left.

---

## 1. Where it stands

**Verified working** — on real hardware or by automated test:

| Area | Evidence |
| --- | --- |
| Create → share → join over real WebRTC | Two browsers, two devices (your Android) |
| Host authority, prediction, reconciliation, interpolation | 122 unit tests, incl. 2/5/10/20-player convergence |
| Gameplay survives the signaling service vanishing | `e2e/p2p-independence.spec.ts` severs both peers' sockets mid-game |
| 20 players simulating and rendering | `?bots=19`, host reports `players 20`, snapshots ~20 Hz |
| Board fits the screen, camera never scrolls | `e2e/board-and-context.spec.ts` |
| Floating joystick, and it no longer steals overlay taps | `e2e/joystick.spec.ts` |
| Player cap, disconnects, spawns, malformed traffic | unit + E2E |
| Signaling hardening (rate limit, origin, oversized frames, room isolation) | `tests/signaling.test.ts` |

**Counts:** 122 unit tests green. 33 E2E, 32 green, 1 flaky (see A1).

**Fixed during QA:** `crypto.randomUUID` outside secure contexts (your phone-as-host bug), stale board size after rotation, fullscreen hiding the joystick, host-render sawtooth, signaling `peerLeft` tearing down healthy P2P games, 5s input-silence reap kicking backgrounded players, `?debug=1` being stripped from the URL.

---

## 2. Open issues

### A. Correctness / robustness

**A1 — One flaky E2E test.** `Priority: medium · Size: S`
The latecomer and reconnect tests alternate failing when the whole suite runs. Root cause is the harness, not the product: headless Chromium only reliably gives animation frames to the foreground page, so with 3+ pages a backgrounded client stops sending input. Passes in isolation every time.
*Fix:* bring each page to front before asserting on state its loop must produce (already done in `waitForPlayerCount`; the remaining path is `waitForSessionReady`). Alternatively split these into their own worker.

**A2 — Room TTL deletes rooms that are still being played.** `Priority: high · Size: S`
`RoomManager.sweep()` compares against `room.createdAt`, so every room dies 30 minutes after creation regardless of activity. Existing P2P play now survives it (fixed), but nobody new can join and the room silently disappears.
*Fix:* track `lastActivityAt`, refresh on join/relay, and sweep on that instead.

**A3 — The host never reconnects to signaling.** `Priority: high · Size: M`
If the host's WebSocket drops — server restart, brief mobile network loss — the host never reconnects and the server deletes the room. The running game is fine, but the invite link is dead for the rest of the session.
*Fix:* auto-reconnect in `SignalingClient` with backoff, plus a server-side "reclaim this room id" path so the same invite link keeps working. Needs a room token so someone else can't claim your id.

**A4 — Input is sent at ~15 Hz, not the configured 20 Hz.** `Priority: medium · Size: S`
`sinceInputMs` accumulates inside `onTick`, which runs at 30 Hz. It crosses the 50 ms threshold only every second tick, so inputs actually leave every ~66 ms. Movement is still correct (each input carries its true `dt`), just coarser than intended — which is part of what you felt as flicker.
*Fix:* accumulate real elapsed time on the frame callback instead of tick count, or set `SIM_TICK_HZ = 20` so the two align.

**A5 — Smoothness needs your re-test.** `Priority: high · Size: —`
The host was resetting its render extrapolation on every simulation tick, even on ticks where no input had arrived, which produced a sawtooth. Now fixed by extrapolating from each player's own last movement. **Please re-test on the phone** — if it still stutters, A4 is the next suspect and I'd also look at snapshot pacing under rAF jitter.

### B. Diagnosability

**B1 — The signaling server logs nothing useful.** `Priority: high · Size: S`
When you asked me to check the logs, they only showed Vite reloads. There is no record of rooms being created, joined, left, swept or rejected.
*Fix:* structured lifecycle logging with room id, peer count and reason. This is what makes the next "it disconnected" answerable.

**B2 — No CI.** `Priority: medium · Size: S`
Nothing runs lint/typecheck/unit/E2E on push. Given how many regressions this QA round surfaced, that is the highest-leverage missing safety net.

### C. Unverified against the acceptance criteria

**C1 — iOS Safari: completely untested.** `Priority: high · Size: M`
Spec §47 requires it. Note you cannot test it over `http://<lan-ip>` — iOS requires a secure context for WebRTC. Needs a dev TLS certificate or a tunnel (see §4).

**C2 — The WhatsApp in-app browser: untested.** `Priority: high · Size: S`
This is the actual runtime for a tapped invite, not Safari/Chrome. If WebRTC misbehaves there, the fix is an "Open in browser" nudge on the join screen.

**C3 — 20 real devices, and 19 peer connections on a host phone.** `Priority: medium · Size: L`
Bots prove the simulation and renderer; they do not prove 19 concurrent `RTCPeerConnection`s on a phone. This remains the project's biggest untested assumption, and the fallback if it fails is architectural (a headless Node host).

**C4 — Docker images have never actually been built.** `Priority: medium · Size: S`
Docker Hub is unreachable from this machine, so `docker compose` was validated but never run. `npm run test:e2e:docker` is therefore unproven.

### D. Known limitations (deliberate, documented)

No TURN (same-WiFi only) · no player reconnection with slot retention · no host migration · host must stay foregrounded.

### E. Cosmetic

**E1** The fullscreen button renders the same glyph in both states — `isFullscreen ? '⛶' : '⛶'`. Harmless, but it was meant to toggle.

---

## 3. Workplan

Ordered so each step makes the next one safer.

### Step 1 — Make failures visible and stop regressions `S`
- B1: structured room lifecycle logging on the signaling server.
- B2: GitHub Actions running typecheck, lint, unit, E2E on push.
- A1: stabilise the last flaky test.
- E1: fix the fullscreen glyph.

*Done when:* CI is green on a clean checkout and the server log shows a readable room story.

### Step 2 — Close the real robustness gaps `M`
- A2: activity-based room TTL.
- A4: true 20 Hz input pacing.
- A5: you re-test smoothness; if still poor, profile snapshot pacing.
- A3: signaling auto-reconnect with room reclaim.

*Done when:* a game survives 45 minutes, a signaling restart, and still accepts new players afterwards.

### Step 3 — Prove the platform claims `M`
- C1 + C2: iOS Safari and the WhatsApp in-app browser, over HTTPS via a tunnel.
- C4: build and run the Docker stack somewhere with registry access.

*Done when:* an invite tapped from a real WhatsApp message works on both iOS and Android.

### Step 4 — Deploy (see §4) `M`

### Step 5 — Scale test `L`
- C3: as many real devices as you can gather, then top up with bots. Measure host CPU, memory and uplink.

*Done when:* the §39 manual script passes on real hardware, or we learn the host-phone ceiling and act on it.

---

## 4. Deployment

### The one change that makes this easy

Right now `VITE_SIGNALING_URL` is baked into the client bundle **at build time** (it is a Docker build arg). That means one image per environment, and a whole class of "works locally, broken in prod" mistakes.

**Recommendation: serve the static build from the signaling Node process and accept the WebSocket upgrade on `/ws` of the same port.**

That gives you:
- **One process, one port, one URL.** Deploy anywhere that runs a container or a Node app.
- **No build-time configuration.** The client derives `wss://<same-origin>/ws` at runtime, so the same artifact runs in every environment.
- **No mixed-content or CORS class of bug.** Page and socket share an origin, so HTTPS implies WSS automatically.
- **No nginx.** The current two-container + proxy setup collapses to one.

Size: small — roughly a static-file handler plus wiring the existing `WebSocketServer` to the same HTTP server, and simplifying `defaultSignalingUrl()`.

### Where to run it

| Option | Verdict |
| --- | --- |
| **Fly.io** | **Recommended.** Runs the container directly, WSS works out of the box, cheap, and can be pinned to a single always-on instance. |
| Render / Railway | Also fine. Make sure to disable scale-to-zero. |
| Cloudflare Pages + separate signaling | Only if you want a CDN for the static side. Two deploys, and the build-arg problem comes back. |
| Anything serverless | **No.** Rooms live in memory and WebSockets are long-lived. |

### Constraints to respect

1. **Single instance only.** Rooms are in-memory, so two replicas would not see each other's rooms. Horizontal scaling needs sticky sessions or shared state — out of scope, but it must be a deliberate decision, not a surprise.
2. **Do not let it cold-start.** A sleeping instance drops every live room. Avoid free tiers that idle.
3. **HTTPS/WSS mandatory.** WebRTC, the Web Share API and `crypto.randomUUID` all need a secure context — the last of which already bit us.
4. **Set `ALLOWED_ORIGINS`** to the deployed origin; empty means allow-all and is development-only.
5. **SPA fallback for `/join/*`.** Serving the static bundle from Node makes this explicit and hard to forget — it is the single most common way to break invite links.

### For testing on iOS before deploying

`cloudflared tunnel --url http://localhost:5173` gives a public HTTPS URL in seconds, which unblocks C1 and C2 without any deployment. Worth doing first, since it may change what we build.

---

## 5. Suggested order

1. Step 1 (CI + logging) — cheap, and everything after benefits.
2. Tunnel + iOS/WhatsApp test — may reveal work that reshapes the rest.
3. Step 2 robustness fixes.
4. Single-port refactor, then deploy to Fly.io.
5. Scale test with real devices.

---

## 6. What has been implemented

**Step 1 — done**
- **B1**: structured room lifecycle logging (`room.created`, `room.joined`, `room.left`,
  `room.host.offline`, `room.reclaimed`, `rooms.swept`, `connection.timeout`), each with room id
  and peer count. Verified live.
- **B2**: GitHub Actions with three jobs — typecheck/lint/unit/audit, Playwright E2E with report
  artifacts on failure, and a container job that builds the image and asserts `/healthz` plus the
  `/join/*` SPA fallback.
- **A1**: `waitForSessionReady` and `waitForPlayerCount` now foreground the page first; the suite
  also allows one retry, because headless Chromium only gives steady animation frames to the
  foreground page. Assertions were not weakened.
- **E1**: fullscreen button now toggles `aria-label`/`aria-pressed` and an active style instead of
  swapping a glyph for itself.

**Step 2 — done**
- **A2**: rooms expire on *inactivity* (`ROOM_IDLE_TTL_MS`, 4h), not age. A long game is never
  swept mid-play.
- **A3**: hosts auto-reconnect with backoff and reclaim their room using a `hostToken`, so the
  original invite link keeps working. A room whose host is away is held for `ROOM_HOST_GRACE_MS`
  (5 min) and reports `hostOffline` to joiners, who get a retry. Covered by unit tests that drop
  the socket and assert a new player can still join afterwards.
- **A4**: input is paced off the wall clock in the frame callback, so it leaves at the configured
  20 Hz rather than 15 Hz.
- **A5**: host render extrapolates from each player's own last movement. **Still needs your
  re-test on the phone.**

**Step 4 — done (deploy still to run)**
- Single process, single port: the signaling service serves `dist/` and accepts the socket at
  `/ws`. `STATIC_DIR` defaults to `./dist`.
- `VITE_SIGNALING_URL` is no longer needed — the client derives `/ws` from its own origin, so one
  image runs everywhere. Vite proxies `/ws` in dev and preview.
- Docker collapsed from two containers plus nginx to one image; `/healthz` added.
- E2E now runs against the production-shaped server rather than `vite preview`.

**Also fixed:** the floating joystick no longer swallows taps meant for the share panel
(z-index layering, with a test that taps Dismiss on a landscape phone viewport).

### Still open

- **C1 / C2**: iOS Safari and the WhatsApp in-app browser — both need a real device and an HTTPS
  tunnel. Highest remaining risk.
- **C3**: 20 real devices, and 19 peer connections on a host phone.
- **C4**: the container has never been built here (no registry access); the CI `docker` job will be
  the first real proof.
- **D**: no TURN, no player reconnection with slot retention, no host migration.

**Counts after this round:** 126 unit tests, 33 E2E, all green. Typecheck, lint and `npm audit`
clean.
