# Phase 3 — Netcode

**Status:** Complete
**Depends on:** Phase 2
**Goal:** movement feels instant locally and smooth remotely, over a real connection with real
latency, while the host stays authoritative.

This is where the product's perceived quality is decided (spec §46 priority #2). Everything here is
testable headlessly through `LoopbackTransport` — build the tests alongside the code, not after.

---

## Tasks

### Host authority (spec §5)

- [ ] `networking/NetworkHost.ts` — authoritative loop at `SIM_TICK_HZ`
- [ ] Per-player input queue; consume at most `MAX_INPUTS_PER_TICK` per tick so a flooding client
      cannot advance itself faster than everyone else
- [ ] Track `lastProcessedInput` per player
- [ ] Broadcast `state` at `SNAPSHOT_HZ` on the **unreliable** channel, carrying `tick`,
      `serverTimeMs`, each player's `lastProcessedInput`, and the player array
- [ ] Reject/clamp every incoming field before it reaches the simulation (spec §34) — a client
      sending `x = 999999` must move nobody

### Client input transmission (spec §9)

- [ ] Sample the joystick at render rate, but emit at `INPUT_HZ` — explicitly **not** one packet per
      frame
- [ ] Monotonic `sequence` per input
- [ ] Send on the **unreliable** channel

### Prediction (spec §10)

- [ ] `networking/Prediction.ts` — apply input locally through `stepPlayer()` immediately on send;
      never wait for the host
- [ ] Ring buffer of `{ sequence, input, dt }`, size `INPUT_BUFFER_SIZE`

### Reconciliation (spec §11)

- [ ] `networking/Reconciliation.ts`:
      1. Set local state to the authoritative position from the snapshot
      2. Drop buffered inputs with `sequence <= lastProcessedInput`
      3. Replay every remaining buffered input through the **same** `stepPlayer()`
      4. Compare the result with the pre-reconciliation predicted position
- [ ] Error below `SNAP_THRESHOLD_PX` → apply as a visual offset that decays over a few frames
      (decision **A5**); at or above → snap
- [ ] Handle the buffer-overflow case: if unacked inputs exceed the buffer, snap and resync

> The replay must call the identical function the host called. A second copy of the movement maths
> is the classic cause of slow drift that only shows up under load.

### Interpolation + dead reckoning (spec §12, §13 — decision **A2**)

- [ ] `networking/Interpolation.ts` — per-remote-player snapshot buffer keyed by `serverTimeMs`
- [ ] Render target time = `now - INTERP_DELAY_MS`; find the two bracketing snapshots; lerp
- [ ] **Only** when the buffer starves: extrapolate from last known `vx`/`vy`, capped at
      `EXTRAP_MAX_MS`, then hold position. Never extrapolate while real snapshots are available.
- [ ] When a real snapshot arrives after extrapolation, blend the correction rather than teleporting
- [ ] Discard snapshots that arrive out of order and older than the current render time (expected on
      an unordered channel — this is the cost of decision **D1** and it is handled here)

### Debug network conditions (spec §40)

- [ ] Wire `VITE_DEBUG_NETWORK_LATENCY_MS` and `VITE_DEBUG_PACKET_LOSS_PERCENT` into **both**
      `WebRTCConnection` and `LoopbackTransport`, so prediction and reconciliation can be exercised
      without a bad network

## Files created

```
src/networking/{Prediction,Reconciliation,Interpolation}.ts
src/networking/NetworkHost.ts        # extended
src/networking/NetworkClient.ts      # extended
tests/{prediction,reconciliation,interpolation,hostAuthority}.test.ts
tests/harness/LoopbackHarness.ts     # 1 host + N clients, scriptable latency/loss
```

## Exit criteria

- [ ] Local player responds to joystick with no perceptible delay, even at 200 ms simulated RTT
- [ ] Remote players move continuously, with no stepping at 20 Hz and no visible teleporting
- [ ] Reconciliation converges — no drift over several minutes of continuous movement
- [ ] A client cannot set its own position; only inputs are accepted
- [ ] Dropping 5% of packets produces no visible stutter
- [ ] Simulation, networking, and rendering run on independent clocks (30 / 20 / ~60 Hz)

## Verification

**Automated** (via `LoopbackHarness`):
- Replaying N buffered inputs equals simulating those N inputs directly
- Under 150 ms RTT, client and host positions converge to within epsilon and stay there
- Reconciliation with zero unacked inputs is a no-op
- Interpolated output is monotonic between two snapshots and never overshoots
- Extrapolation stops at exactly `EXTRAP_MAX_MS` and then holds
- Out-of-order and duplicate snapshots do not move a remote player backwards
- Host clamps hostile input: `{ x: 1e9, y: NaN, sequence: -1 }` is rejected, player unmoved
- Input flood: 1000 queued inputs advance the player by at most `MAX_INPUTS_PER_TICK` per tick

**Manual:**
- Two phones, `VITE_DEBUG_NETWORK_LATENCY_MS=200`, `VITE_DEBUG_PACKET_LOSS_PERCENT=5`
- Local player must still feel instant; remote player must still look smooth
- Run in a circle for two minutes and confirm no accumulating offset between the two views

## Risks / watch items

- **Time base.** Client and host clocks are unsynchronised. Build the interpolation timeline from
  `serverTimeMs` deltas plus local arrival time, not from raw `Date.now()` differences — otherwise
  clock skew shows up as a permanent interpolation offset.
- **`dt` mismatch on replay.** Store the actual `dt` used with each buffered input; replaying with a
  nominal fixed `dt` reintroduces drift.
- **Over-smoothing.** Too generous a `SNAP_THRESHOLD_PX` or too slow an offset decay turns
  corrections into visible rubber-banding. Tune on hardware.

## Deviations log

- **Prediction runs per input packet (20 Hz), not per rendered frame.** Predicting every frame but
  sending at 20 Hz would make the replayed path differ from the predicted one. To keep rendering
  smooth at 60 FPS without adding latency, the renderer extrapolates from the last predicted state
  using its velocity — exact for this simulation, since velocity is constant between inputs.
- **`ack` is carried per player inside the snapshot** rather than as a separate top-level field, so
  one message serves everyone.
- **Clocks are injectable** on `NetworkHost` and `NetworkClient`. Without this the netcode could not
  be driven deterministically from tests.
- `MAX_QUEUED_INPUTS` (8 × `MAX_INPUTS_PER_TICK`) bounds a flooding client's queue.
