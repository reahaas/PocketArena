# Decisions & Resolved Ambiguities

Read this before writing any code. It records where we deliberately diverge from
`../SystemDescription.txt` and where the spec was silent or self-contradictory.

---

## 1. Approved deviations from the spec

### D1 — Two DataChannels, not one (deviates from spec §7)

**Spec says:** one reliable, ordered DataChannel for the MVP.
**We do:** two channels per peer connection.

| Channel | Config | Carries |
| --- | --- | --- |
| `unreliable` | `{ ordered: false, maxRetransmits: 0 }` | `input`, `state` snapshots, `ping`/`pong` |
| `reliable` | `{ ordered: true }` (default) | `join`, `welcome`, `playerJoined`, `playerLeft`, `gameStarted`, `rejected` |

**Why:** a reliable ordered channel head-of-line blocks. One lost 20 Hz snapshot stalls every later
snapshot until it is retransmitted, producing exactly the rubber-banding that prediction and
interpolation exist to hide. Spec §46 ranks perceived responsiveness as priority #2, so the spec
contradicts itself here. Stale snapshots are worthless anyway — dropping them is correct. Cost is
one extra `createDataChannel` call.

### D2 — Host backgrounding is explicitly handled (spec is silent)

**Problem:** the spec's own host flow is Create Game → Share → *switch to WhatsApp*. Backgrounding
the tab throttles timers to ~1 Hz on iOS Safari or suspends the page outright; screen lock does the
same. The authoritative simulation and all peer connections stall. Every player freezes.

**We do:**
- Request `navigator.wakeLock('screen')` when the host enters the game; re-acquire on
  `visibilitychange` (the lock is released automatically when the page hides).
- On `document.hidden`: pause the simulation cleanly, stop broadcasting, notify clients so they
  show "Game paused" rather than silently freezing.
- On visible: resume from current wall clock. Do **not** replay the elapsed gap.
- Document the residual iOS risk in the project README.

**Rejected:** moving authority to a headless Node host. It solves the problem completely but
contradicts spec §4 ("no game server"). Kept as the documented fallback if Phase 4 shows a host
phone cannot sustain 19 peer connections.

### D3 — STUN only, no TURN (accepts a spec §7 "future" as a hard MVP limit)

Same-WiFi operation is assumed, consistent with the "physically together" product premise.
Mixed mobile-carrier NAT / CGNAT will fail for some players and that is accepted for the MVP.

- `VITE_STUN_SERVERS` is honoured as specified.
- `VITE_TURN_URL` / `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL` exist in `.env.example` and are
  read by the ICE config builder, but are unset. Provisioning TURN later requires no code change.
- The limitation is stated in the project README.

---

## 2. Resolved ambiguities

### A1 — "No lobby" vs. the waiting UI

Spec §24/§45 forbid a lobby; spec §30 shows `Waiting for players...` and `Players: 7 / 20`.
**Resolution:** the host drops straight into the live arena. The share sheet and player counter
render as a dismissible **overlay on top of the running game**, not as a separate screen. Nobody
waits for anybody.

### A2 — Interpolation (§12) vs. dead reckoning (§13)

Presented as two requirements; they are one strategy with a fallback.
**Resolution:** render remote players at `now - INTERP_DELAY_MS` and interpolate between the two
bracketing snapshots. Extrapolate from last known `vx`/`vy` **only** when the buffer starves, capped
at `EXTRAP_MAX_MS`, then hold position. Never extrapolate while real snapshots are available.

### A3 — "Deterministic" simulation (§14)

This is state-synchronised, not lockstep, so bit-level determinism buys nothing.
**Resolution:** the real requirement is that host and client run the *same* `stepPlayer()` function
and that it is frame-rate independent. No fixed-point maths, no seeded RNG.

### A4 — Reconnection

The spec never defines it. Spec §23 says a disconnect frees the slot.
**Resolution:** out of scope. Disconnect frees the slot immediately; a page refresh is a brand-new
player with a new ID and a new spawn. Documented in the project README so it is a known behaviour
rather than a bug report.

### A5 — Correction smoothing threshold (§13 "large corrections may be snapped")

**Resolution:** error below `SNAP_THRESHOLD_PX` is applied as a visual offset that decays over a few
frames; at or above it, snap immediately.

### A6 — Player identity

No names (spec §2), but labels are required (spec §17).
**Resolution:** players are `P1`–`P20` by slot index, with a deterministic 20-colour palette indexed
the same way. Slot index is assigned by the host and is stable for the session.

---

## 3. Tunable constants

All of these live in `src/config/config.ts`. Nothing else may hard-code them.

| Constant | Value | Notes |
| --- | --- | --- |
| `SIM_TICK_HZ` | 30 | Spec §15 allows 20–30 |
| `SNAPSHOT_HZ` | 20 | Host → client broadcast rate, spec §28 |
| `INPUT_HZ` | 20 | Client → host, spec §9 |
| `INTERP_DELAY_MS` | 100 | Two snapshots at 20 Hz — one may be lost without starving |
| `EXTRAP_MAX_MS` | 250 | Dead-reckoning cap before freezing |
| `SNAP_THRESHOLD_PX` | 120 | Above this, snap instead of smoothing |
| `PLAYER_SPEED` | 320 px/s | Retune during Phase 1 playtest |
| `PLAYER_RADIUS` | 24 px | Also drives spawn-circle spacing |
| `ARENA_WIDTH` / `ARENA_HEIGHT` | 2000 / 2000 | Larger than any viewport, spec §18 |
| `MAX_PLAYERS` | 20 | Spec §3 |
| `JOYSTICK_DEADZONE` | 0.15 | Rescaled so output ramps 0→1 from the deadzone edge |
| `INPUT_BUFFER_SIZE` | 128 | Prediction ring buffer; ~6s at 20 Hz |
| `MAX_INPUTS_PER_TICK` | 4 | Anti-flood: caps how much a client can advance per tick |
| `ROOM_TTL_MS` | 1_800_000 | Signaling sweeper, 30 min |
| `DISCONNECT_TIMEOUT_MS` | 5_000 | No input + no ICE → drop player |
| `WS_MSG_MAX_BYTES` | 4096 | Signaling message size cap |
| `WS_MSGS_PER_SEC` | 30 | Signaling per-connection rate limit |
| `ROOM_ID_LENGTH` | 6 | Crockford base32, I/L/O/U removed → ~1e9 space |

---

## 4. Explicitly out of scope

Auth, accounts, matchmaking, chat, voice, scoring, weapons, enemies, inventory, persistence, host
migration, TURN provisioning, delta compression, interest management, spatial partitioning, binary
encoding, reconnection.

Per spec §44 the seams must exist so these can be added later — specifically the `Transport`
interface, the serializer encode/decode seam, and authority living in `GameSimulation` rather than
in networking code.
