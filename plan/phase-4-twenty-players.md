# Phase 4 — 20 Players & Failure Handling

**Status:** Complete (hardware profiling outstanding)
**Depends on:** Phase 3
**Goal:** the game survives 20 simultaneous players, players leaving, the host leaving, and the host
switching to WhatsApp.

Everything up to now has been the happy path with two devices. This phase is where the untested
assumptions get measured.

---

## Tasks

### Spawns & identity (spec §25, §26)

- [ ] `game/SpawnPoints.ts` — 20 deterministic points on a circle, radius sized so no two players
      overlap given `PLAYER_RADIUS`. Assigned by slot index. **Never (0,0)**.
- [ ] Joining a live game: host sends `welcome` then the current full state on the reliable channel;
      the client initialises remote players and starts prediction **before** the first render, so
      there is no flash at the origin (spec §25)
- [ ] Slot index drives both the `P<n>` label and the palette colour (decision **A6**), stable for
      the session

### Player cap (spec §3)

- [ ] Enforce `MAX_PLAYERS` on the signaling server **and** on the host — the server cap is a fast
      reject, the host cap is the authoritative one
- [ ] Player 21 sees a clean **"Game is full"** screen
- [ ] `Players: n / 20` counter in the share overlay

### Disconnect handling (spec §23)

- [ ] Player disconnect detected via `connectionstatechange` / channel close / `DISCONNECT_TIMEOUT_MS`
      of silence → remove from simulation, broadcast `playerLeft`, destroy sprite, free the slot
- [ ] Host disconnect → clients show **"Host disconnected"** and return to the home screen
- [ ] No host migration (spec §44), but authority stays inside `GameSimulation` + `NetworkHost` so it
      could be relocated later
- [ ] WebRTC failure paths: ICE failure, channel error, signaling server unreachable — each produces
      a clear user-facing message and a retry path, never a blank screen

### Host backgrounding (decision **D2**)

- [ ] Request `navigator.wakeLock('screen')` when the host enters the game
- [ ] Re-acquire on `visibilitychange` — the lock is released automatically when the page hides
- [ ] On `document.hidden`: pause the simulation cleanly, stop broadcasting, notify clients so they
      show "Game paused" instead of silently freezing
- [ ] On visible: resume from current wall clock; do **not** replay the elapsed gap
- [ ] Feature-detect — Wake Lock is unavailable in some iOS versions and in some in-app browsers

### Debug tooling (spec §40)

- [ ] `ui/DebugOverlay.ts`, gated behind `?debug=1` and hidden for normal users:
      connection state, RTT, simulation tick, input sequence, last acknowledged input, player count,
      measured snapshot rate, dropped-packet count

### 20-player harness

- [ ] `?bots=19` dev flag — host spawns 19 synthetic input-driven players locally, exercising the
      simulation and render path at full population
- [ ] Headless Vitest scenario: 1 host + 19 `LoopbackTransport` clients under latency and loss,
      asserting convergence and message volume
- [ ] Measure real peer-connection load: 19 concurrent `RTCPeerConnection`s on a host phone

### Performance pass (spec §29)

- [ ] Profile with 20 moving players: no per-frame allocation, no unnecessary DOM writes, no Phaser
      object churn, no full scene recreation
- [ ] Confirm message sizes stay compact — no assets, no metadata, no redundant fields (spec §27)

## Files created

```
src/game/SpawnPoints.ts
src/ui/{DebugOverlay,GameFullScreen,HostDisconnectedScreen}.ts
src/utils/wakeLock.ts
tests/{spawnPoints,playerCap,disconnect}.test.ts
tests/harness/twentyPlayers.test.ts
```

## Exit criteria

- [ ] 20 players connect to one host and all are visible to everyone
- [ ] 20 players moving simultaneously sustains 60 FPS on a mid-range Android
- [ ] Player 21 is rejected gracefully with "Game is full"
- [ ] Joining a running game shows the new player to everyone immediately, with no (0,0) flash
- [ ] A player disconnecting removes them everywhere and frees their slot; everyone else plays on
- [ ] Host disconnecting shows "Host disconnected" on every client
- [ ] Host backgrounding pauses cleanly and resumes without desync
- [ ] `?debug=1` shows the full HUD; without it, no networking terminology is visible anywhere

## Verification

**Automated:** 20 spawn points are pairwise non-overlapping and deterministic; the 21st join is
rejected; a disconnect frees exactly one slot; the headless 1-host/19-client scenario converges.

**Manual:**
- `?bots=19` on a real mid-range Android, profiling frame time
- As many physical devices as available, then top up with desktop tabs
- Kill a client mid-game; kill the host mid-game
- Host: create game → share → switch to WhatsApp → return; confirm clean pause and resume
- Lock the host's screen; confirm the wake lock holds or the pause path engages

## Risks / watch items

- **19 concurrent `RTCPeerConnection`s on a host phone is the project's biggest untested
  assumption.** If it fails — thermal throttling, memory pressure, ICE gathering stalls — the
  documented fallback is the headless Node host deferred in decision **D2**. Measure this early in
  the phase, not at the end, because the fallback is an architectural change.
- Snapshot bandwidth at 20 players × 20 Hz is fine in aggregate, but the host uploads to 19 peers.
  Mobile uplink is the constraint, not CPU. If it saturates, the first lever is reducing
  `SNAPSHOT_HZ`, not adding delta compression (spec §28 says do not prematurely optimise).
- Wake Lock support is inconsistent across iOS versions and in-app browsers. Feature-detect and fall
  back to the pause path rather than assuming it exists.

## Deviations log

Four real bugs surfaced while driving this in a browser, all now fixed and covered by tests:

1. **A peer joining while the host was paused was never told.** `setPaused` broadcast to whoever was
   connected at the time; a later joiner only got `welcome`. `acceptPeer` now sends the paused state
   too.
2. **The host only reacted to visibility *changes*.** If the tab was already hidden when the game
   started, no `visibilitychange` fired, so the host silently stopped broadcasting with clients
   none the wiser. The handler is now invoked once on startup.
3. **Resuming from pause dropped every player.** Peers' `lastSeenMs` went stale during the pause, so
   the first `afterFrame` after resuming reaped all of them as timed out. `setPaused(false)` now
   refreshes them.
4. **`history.replaceState` discarded the query string**, killing `?debug=1` and `?bots=N` before
   they were ever read. Both the home route and the host route now preserve it.

Other notes:

- The player counter is event-driven via `onPlayerCountChange` rather than polled each frame, so it
  stays correct while the tab is backgrounded and animation frames have stopped.
- "Game paused" is its own indicator state rather than being shown as "Reconnecting", which was
  misleading.
- **Still outstanding:** frame-time profiling with 20 players on a real mid-range Android, and
  measuring 19 concurrent `RTCPeerConnection`s on a host phone. The integrated browser used for
  verification does not run animation frames continuously, so FPS could not be measured there.
