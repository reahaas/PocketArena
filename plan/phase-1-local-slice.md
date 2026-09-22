# Phase 1 — Local Slice (no networking)

**Status:** Complete
**Depends on:** Phase 0
**Goal:** on a real phone, you can drive a circle around an arena at 60 FPS with a virtual joystick,
and on desktop with WASD — with zero networking code involved.

This phase builds the pure simulation core that everything else is layered onto. If `stepPlayer()`
and the input abstraction are right here, Phase 3's netcode is mostly plumbing. If they are wrong,
Phase 3 is a nightmare.

---

## Tasks

### Simulation (pure, no browser)

- [ ] `game/GameSimulation.ts` — owns `Map<PlayerId, PlayerState>`; add/remove/get players; `tick()`
- [ ] Export `stepPlayer(state, input, dt): PlayerState` as a **pure function**:
      normalize input → clamp magnitude to ≤ 1 → `v = input * PLAYER_SPEED` → `pos += v * dt` →
      clamp to arena bounds inset by `PLAYER_RADIUS`
- [ ] `game/types.ts` — `PlayerState { id, x, y, vx, vy }`, `InputVector { x, y }`, `PlayerId`

> Clamping magnitude to 1 rather than normalising unconditionally is what makes diagonals correct
> *and* preserves analogue partial-tilt on a joystick. Normalising every vector would make a
> half-tilt run at full speed.

### Loop

- [ ] `game/GameLoop.ts` — fixed-timestep accumulator at `SIM_TICK_HZ`, driven by `requestAnimationFrame`
      but **not** by Phaser's `update()`. Guard against the spiral of death (max 5 catch-up steps
      per frame, then discard the backlog).
- [ ] Expose an interpolation alpha for the renderer so rendering stays smooth between sim ticks.

### Input

- [ ] `input/InputSource.ts` — interface `{ read(): InputVector; isActive(): boolean }`
- [ ] `input/VirtualJoystick.ts` implements it [parallel with KeyboardInput]
- [ ] `input/KeyboardInput.ts` implements it — WASD + arrows (spec §21) [parallel with VirtualJoystick]
- [ ] `input/InputManager.ts` — merges sources; whichever is active wins, joystick takes precedence

**Joystick requirements (spec §19), the fiddly parts:**
- Pointer Events, not touch events. `setPointerCapture` on the tracked pointer.
- Track exactly one `pointerId`; ignore all others. This is what makes it multitouch-safe and stops
  it stealing unrelated touches.
- Activation zone = bottom-left quadrant only. A pointerdown outside it is not the joystick's.
- Dead zone `JOYSTICK_DEADZONE`, **rescaled** so output ramps 0→1 from the deadzone edge rather than
  jumping to 0.15.
- `touch-action: none` on the canvas and joystick element.

### Rendering

- [ ] `game/Arena.ts` — bounds, background grid, world larger than viewport
- [ ] `game/Player.ts` — a circle + `P<n>` label; local player gets a distinguishing ring
- [ ] `game/PlayerManager.ts` — pooled sprite create/update/destroy; **no per-frame allocation**
- [ ] `game/GameScene.ts` — Phaser scene; reads simulation state and renders it; camera follows local
      player, clamped to arena bounds
- [ ] `game/Game.ts` — Phaser boot/config, `Scale.RESIZE`
- [ ] `utils/palette.ts` — 20 deterministic, visually distinguishable colours indexed by slot

### Mobile viewport (spec §20)

- [ ] `100dvh` layout, `overscroll-behavior: none`, `user-select: none`, no page scrolling
- [ ] Listen to `visualViewport` `resize`/`scroll` and `orientationchange` — **not**
      `window.innerHeight` (spec §20 calls this out explicitly; mobile browser chrome resizes it)
- [ ] `env(safe-area-inset-*)` padding on the UI layer so the joystick clears the home indicator

## Files created

```
src/game/{types,GameSimulation,GameLoop,Game,GameScene,Player,PlayerManager,Arena}.ts
src/input/{InputSource,InputManager,VirtualJoystick,KeyboardInput}.ts
src/utils/{palette,math}.ts
tests/simulation.test.ts
tests/joystick.test.ts
```

## Exit criteria

- [ ] A circle moves under joystick control on iOS Safari and Android Chrome
- [ ] WASD/arrows move the same circle on desktop, through the same `InputManager`
- [ ] Diagonal movement is not faster than cardinal movement
- [ ] The player cannot leave the arena
- [ ] No page scroll, zoom, text selection, or pull-to-refresh on either mobile browser
- [ ] Rotating the device and opening/closing browser chrome does not break the layout
- [ ] 60 FPS sustained
- [ ] `GameSimulation.ts` has zero imports from Phaser or the DOM (lint-enforced from Phase 0)

## Verification

**Automated** (`npm run test`):
- `stepPlayer` frame-rate independence: one 100 ms step ≈ ten 10 ms steps, within epsilon
- diagonal `(1,1)` produces the same speed as `(1,0)`
- boundary clamping at all four edges and corners
- deadzone: input below threshold → exactly `(0,0)`; just above → small non-zero, not 0.15
- joystick output magnitude never exceeds 1

**Manual:**
- Load on a physical iPhone and a physical Android device — simulators hide viewport bugs
- Drag from outside the activation zone and confirm the joystick does not grab it
- Two fingers down simultaneously; joystick tracks only its own pointer

## Risks / watch items

- iOS Safari viewport handling is the single most common source of "works on desktop, broken on
  phone". Test on hardware early, not at the end of the phase.
- Per-frame allocation in the render path is easy to introduce and hard to find later (spec §29).
  Reuse vectors and sprites from the start.
- `PLAYER_SPEED` will almost certainly need retuning once you play it on a phone. Change it in
  config and note the new value in `decisions.md` §3.

## Deviations log

- **`stepPlayer` clamps `dt` itself** to `MAX_INPUT_DT` rather than trusting callers. It is the
  boundary that matters most, and clamping there makes every call site safe by construction.
- **Joystick maths extracted to `utils/math.ts`** (`applyDeadzone`, `clampMagnitude`) so the fiddly
  part is unit-testable without a DOM.
- Camera follows the local player via `cameras.main.centerOn`, which the arena bounds clamp.
