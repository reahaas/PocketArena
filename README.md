# Pocket Arena

A mobile-first browser multiplayer arena for people who are in the same room. The host creates a
game, shares one link, and up to 20 players tap it and start playing. No accounts, no lobby, no
room codes, no QR.

- 2D arena with a virtual joystick
- Up to 20 players over peer-to-peer WebRTC
- Host-authoritative simulation with client-side prediction, reconciliation and interpolation
- A tiny WebSocket signaling service, no database, no persistent state

## Quickstart

```bash
npm install
cp .env.example .env
npm run dev:all
```

Open <http://localhost:5173>, press **Create Game**, and open the generated link on another device
on the same WiFi.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server for the game client |
| `npm run dev:server` | Signaling service on `PORT` |
| `npm run dev:all` | Both of the above together |
| `npm run build` | Typecheck all three projects, then build to `dist/` |
| `npm run typecheck` | Client, server and test/tooling typechecks |
| `npm run lint` | ESLint |
| `npm run test` | Vitest unit and integration tests |
| `npm run test:e2e` | Playwright end-to-end tests against a local build |
| `npm run test:e2e:docker` | Same suite against the Docker stack |
| `npm run docker:up` | Build and start the full stack on <http://localhost:8080> |
| `npm run docker:down` | Stop it and remove volumes |

## Architecture

Connection setup goes through the signaling service. Gameplay never does.

```
                       Signaling service
                      (WebSocket, in-memory)
                     /         |         \
                  setup      setup      setup
                   /           |           \
                HOST        Player 2     Player 3
             authoritative
                  |
      ┌───────────┼───────────┐
      ▼           ▼           ▼
   Player 2    Player 3   ...Player 20
      (one WebRTC connection each, to the host)
```

Each non-host player holds exactly one gameplay connection, to the host. There is no full mesh.

**Two data channels per connection.** Inputs and state snapshots go over an unreliable, unordered
channel; join/leave and other lifecycle messages go over a reliable one. A reliable-only channel
would head-of-line block, so one lost snapshot would stall every fresher one.

**Clients send input, never position.** The host runs the only authoritative simulation. A client
that sends `x = 999999` moves nobody.

**Layering.** `src/game/GameSimulation.ts` imports nothing from Phaser, the DOM or WebRTC, and
movement lives in exactly one function — `stepPlayer()` — shared by the host, client prediction and
reconciliation replay. Both rules are enforced by ESLint.

```
src/
  app/          App shell, routing, session wiring
  config/       Every tunable constant
  dev/          Bot swarm for load testing
  game/         Simulation, fixed-timestep loop, Phaser rendering
  input/        InputSource interface, virtual joystick, keyboard
  networking/   Protocol, serializer, host, client, prediction/reconciliation/interpolation
    transport/  Transport interface, WebRTC and in-process loopback implementations
  room/         Room ids, invite links
  ui/           Screens and overlays
server/         Signaling service
tests/          Unit tests plus a headless multiplayer harness
```

## Configuration

All tunables live in [`src/config/constants.ts`](src/config/constants.ts) — simulation tick rate,
snapshot rate, interpolation delay, player speed, arena size, room limits and signaling hardening.

Environment variables (see `.env.example`):

| Variable | Purpose |
| --- | --- |
| `VITE_SIGNALING_URL` | Optional override. Unset by default: the client uses `/ws` on its own origin |
| `VITE_STUN_SERVERS` | Comma-separated STUN URLs |
| `VITE_TURN_URL` / `_USERNAME` / `_CREDENTIAL` | Optional TURN, unset by default |
| `VITE_DEBUG_NETWORK_LATENCY_MS` | Artificial latency for local testing |
| `VITE_DEBUG_PACKET_LOSS_PERCENT` | Artificial packet loss for local testing |
| `PORT` | Port for the server (client and signaling share it) |
| `STATIC_DIR` | Directory to serve. Defaults to `./dist` when it exists |
| `ALLOWED_ORIGINS` | Comma-separated origin allowlist. Empty means allow all — development only |

## Developer tools

| Flag | Effect |
| --- | --- |
| `?debug=1` | Connection state, RTT, tick, input sequence, last ack, player count, snapshot rate |
| `?bots=N` | Host spawns N synthetic players (max 19) to load the simulation and renderer |

Combine with the latency/loss variables to exercise prediction and reconciliation without a bad
network, for example `VITE_DEBUG_NETWORK_LATENCY_MS=200 VITE_DEBUG_PACKET_LOSS_PERCENT=5 npm run dev`.

## Testing

```bash
npm run test       # 122 unit and integration tests
npm run test:e2e   # 17 browser tests, real WebRTC between two pages
```

**Unit and integration.** `tests/harness/Harness.ts` runs a real host and real clients over an
in-process transport with a controllable clock. That is how the 2, 5, 10 and 20-player scenarios,
join-while-running, disconnects and packet loss are verified without twenty devices.

`tests/signaling.test.ts` runs the actual signaling service over real WebSockets and covers room
creation, capacity, relay isolation between rooms, host departure, malformed frames, oversized
frames, rate limiting and the origin allowlist. `tests/signalingClient.test.ts` covers the client
side, including the message-ordering race described below.

**End to end.** The Playwright suite drives two real browser pages through a real peer connection:
host creates a game, guest opens the invite link, each one moves and the other sees it, prediction
agrees with host authority, players cannot leave the arena, disconnects on both sides are handled,
a latecomer joins mid-match, and the 21st player is refused.

Chromium is launched with background throttling disabled
(`--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows`,
`--disable-renderer-backgrounding`). Without those flags the host page stops animating the moment
the guest page takes focus and the multiplayer assertions become meaningless.

The suite relies on a `window.__pocketArena` hook that exposes a read-only view of the rendered
players. It only exists when the game is running with `?debug=1`, so it is absent for normal
players — there is a test asserting exactly that.

## Docker

```bash
npm run docker:up            # http://localhost:8080
npm run test:e2e:docker      # run the E2E suite against it
npm run docker:down
```

Two services. `signaling` runs the Node service as a non-root user with a WebSocket health check.
`web` builds the client and serves it through nginx, which does two jobs worth calling out:

- **`try_files $uri $uri/ /index.html`** — the SPA fallback. Without it every invite link 404s,
  which is the single most common way to break this product on deploy.
- **`/ws` proxied to the signaling container** with the `Upgrade` headers, so the browser talks to
  one origin and `ALLOWED_ORIGINS` can be pinned to it.

Running the E2E suite against the container stack is what actually exercises the nginx rewrite,
rather than Vite's built-in dev fallback.

## Known limitations

These are deliberate for the MVP, not bugs:

- **Same-network only.** STUN is configured but TURN is not provisioned, so players behind
  different carrier NATs may fail to connect. This matches the "everyone is in the same room"
  premise. Setting the `VITE_TURN_*` variables is all that is needed to lift it.
- **The host must stay in the foreground.** Browsers stop animation frames for hidden tabs, so a
  backgrounded host cannot simulate. The host requests a screen wake lock and, when hidden, pauses
  cleanly and tells everyone ("Game paused") rather than silently freezing. Wake Lock is
  unsupported in some iOS versions and in-app browsers. Practically: share the link, then come back
  to the game.
- **No reconnection.** A disconnect frees the slot immediately and a page refresh joins as a brand
  new player with a new colour and spawn.
- **No host migration.** If the host leaves, the game ends and everyone is told.
- **In-app browsers.** Links tapped inside WhatsApp open in an embedded WebView rather than
  Safari/Chrome. Test there before relying on it.

## Deployment

**One process, one port.** The signaling service also serves the built client, and the WebSocket
lives at `/ws` on the same origin. There is no build-time configuration, so one image runs in every
environment, and HTTPS implies WSS with no mixed-content or CORS surface.

```bash
docker compose up --build   # http://localhost:8080
```

To deploy, push that image anywhere that runs a container. **Render's free tier** is the
recommended option — see below. Set `ALLOWED_ORIGINS` to your public origin and you are done.

Three constraints that must be deliberate choices rather than surprises:

1. **Single instance.** Rooms live in memory, so two replicas would not see each other's rooms.
   Horizontal scaling needs sticky sessions or shared state.
2. **Never let it cold-start.** A sleeping instance drops every live room. Avoid tiers that idle.
3. **HTTPS is required in production.** WebRTC, the Web Share API and `crypto.randomUUID` all need
   a secure context.

`/healthz` returns `200 ok` for platform health checks.

### Deploying to Render (free)

A [`render.yaml`](render.yaml) Blueprint is included, so this is a one-click deploy once the repo is
on GitHub:

1. Push this repo to GitHub.
2. In the [Render Dashboard](https://dashboard.render.com), click **New +** → **Blueprint**, and
   select the repo. Render reads `render.yaml` and provisions the `pocket-arena` web service on the
   Free plan automatically (Docker build, `/healthz` health check).
3. After the first deploy, copy the assigned `https://<name>.onrender.com` URL, open the service's
   **Environment** tab, and set `ALLOWED_ORIGINS` to that exact URL. Redeploy for it to take effect.

Why Render's free tier works for this app despite its idle spin-down policy: a free instance only
spins down after **15 minutes with zero inbound traffic** (HTTP or WebSocket). The signaling client
sends a heartbeat every `WS_HEARTBEAT_MS` (15s) over the WebSocket that stays open for the lifetime
of a session, so any room with a connected browser tab keeps the server awake indefinitely. Spin-down
can only happen after everyone has actually left — at which point losing in-memory room state is
correct behavior, not a bug. The only user-visible cost is a ~1 minute cold start for the very first
visitor after a long period with no one connected at all.

If you outgrow the free tier's limits (750 instance-hours/month, 0.1 CPU / 512 MB RAM), the same
Dockerfile runs unchanged on a paid Render plan or on Fly.io.

### Testing on a phone before deploying

iOS refuses WebRTC over a plain-HTTP LAN address, so `http://<your-ip>:5173` will not work there.
Use a tunnel to get HTTPS in seconds:

```bash
cloudflared tunnel --url http://localhost:5173
```

## Planning documents

[`plan/`](plan) holds the phased implementation plan and, in
[`plan/decisions.md`](plan/decisions.md), the deviations from the original specification along with
the reasoning behind each one.
