# Pocket Arena — Implementation Plan

This folder is the working plan for building the Pocket Arena MVP described in
`../SystemDescription.txt`. It is the execution contract: the spec says *what*, this folder says
*in what order, with what decisions already made, and how we know a step is finished*.

## Folder contents

| File | Purpose |
| --- | --- |
| `README.md` | This file — how the plan is organised and how to work with it |
| `review-and-workplan.md` | **Current state, open issues and what to do next** — start here |
| `decisions.md` | Locked-in decisions, spec deviations, resolved ambiguities, tunable constants |
| `phase-0-scaffold.md` | Toolchain, folder structure, config, npm scripts |
| `phase-1-local-slice.md` | Playable single-player slice: sim, loop, input, render, mobile viewport |
| `phase-2-signaling-webrtc.md` | Signaling server, rooms, invite links, transport layer, first 2-player link |
| `phase-3-netcode.md` | Host authority, prediction, reconciliation, interpolation, dead reckoning |
| `phase-4-twenty-players.md` | Spawns, player cap, disconnects, wake lock, debug HUD, load harness |
| `phase-5-tests-docs-deploy.md` | Full test suite, hardening, README, deployment |

## Phase map

```
Phase 0  Scaffold
   |
Phase 1  Local slice          <- playable, no networking
   |
Phase 2  Signaling + WebRTC   <- two players see each other
   |
Phase 3  Netcode              <- it feels good
   |
Phase 4  20 players           <- it survives reality
   |
Phase 5  Tests + deploy       <- it ships
```

Phases are strictly sequential — each depends on the one before it. Tasks *within* a phase are
marked `[parallel]` where they have no dependency on each other.

## How to work with this plan

**1. Read `decisions.md` first, every session.**
It contains three deliberate deviations from `SystemDescription.txt` and several ambiguities the
spec left open. Implementing straight from the spec without reading it will produce the wrong
architecture.

**2. Work one phase at a time.**
Do not start phase N+1 until every exit criterion in phase N passes. The phases are ordered so that
each one de-risks the next; skipping ahead means discovering the WebRTC problems after the netcode
is already written against wrong assumptions.

**3. Each phase document has the same shape:**

- **Goal** — one sentence, what this phase makes true
- **Depends on** — prerequisite phase
- **Tasks** — checkboxes, in order, with the files each one touches
- **Files created** — full paths, so structure stays consistent with spec §36
- **Exit criteria** — must ALL pass before moving on
- **Verification** — the exact commands and manual steps that prove the exit criteria
- **Risks / watch items** — what is most likely to go wrong here
- **Deviations log** — empty at the start; record anything done differently and why

**4. Tick the checkboxes as you go and update the `Status:` line at the top of the phase doc**
(`Not started` → `In progress` → `Complete`). The plan is the source of truth for progress.

**5. Record deviations, don't silently absorb them.**
If reality forces a change (an API behaves differently, a constant needs retuning), append it to
that phase's Deviations log and, if it affects later phases, update `decisions.md`.

**6. Constants live in `src/config/config.ts` only.**
No magic numbers anywhere else. If a phase needs a new tunable, add it to config and to the table
in `decisions.md`.

## Architectural rules that apply to every phase

These are non-negotiable and derive from spec §37. Violating them is the most likely way this
project becomes unmaintainable:

- `GameSimulation.ts` imports **nothing** from Phaser, the DOM, or WebRTC. It must be unit-testable
  in plain Node.
- Gameplay code never touches `RTCPeerConnection` directly — only the `Transport` interface.
- Movement maths exists in exactly one function, `stepPlayer()`. Host simulation, client prediction,
  and reconciliation replay all call it. Two copies of this function is the classic source of
  desync bugs.
- Keyboard and joystick are both `InputSource` implementations feeding one pipeline. There is no
  separate keyboard movement path (spec §21).
- Simulation, networking, and rendering run on separate clocks: 30 Hz, 20 Hz, ~60 FPS.

## Definition of done for the project

Spec §47's acceptance checklist, verified by the manual multiplayer script in spec §39. Phase 5
covers walking both.
