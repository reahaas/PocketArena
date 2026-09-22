import { CORRECTION_DECAY_PER_FRAME, SNAP_THRESHOLD_PX } from '../config/constants';
import { stepPlayer } from '../game/GameSimulation';
import type { PlayerState, Vector2 } from '../game/types';
import type { PendingInput } from './Prediction';

export interface ReconcileResult {
  state: PlayerState;
  errorPx: number;
  snapped: boolean;
}

/**
 * Re-runs the still-unacknowledged inputs on top of the authoritative state, using the exact
 * `dt` each one was predicted with. Replaying with a nominal fixed dt would reintroduce drift.
 */
export function replayInputs(
  authoritative: Readonly<PlayerState>,
  pending: readonly PendingInput[],
): PlayerState {
  let state: PlayerState = { ...authoritative };
  for (const entry of pending) {
    state = stepPlayer(state, entry.input, entry.dt);
  }
  return state;
}

export function reconcile(
  authoritative: Readonly<PlayerState>,
  pending: readonly PendingInput[],
  predicted: Readonly<PlayerState>,
): ReconcileResult {
  const state = replayInputs(authoritative, pending);
  const errorPx = Math.hypot(state.x - predicted.x, state.y - predicted.y);

  return { state, errorPx, snapped: errorPx >= SNAP_THRESHOLD_PX };
}

/**
 * Carries a small positional error as a visual offset that decays over a few frames, so
 * routine corrections are invisible instead of showing up as a twitch (decision A5).
 */
export class CorrectionSmoother {
  private offset: Vector2 = { x: 0, y: 0 };

  absorb(errorX: number, errorY: number, snap: boolean): void {
    if (snap) {
      this.offset = { x: 0, y: 0 };
      return;
    }
    this.offset = { x: this.offset.x + errorX, y: this.offset.y + errorY };
  }

  /** Call once per rendered frame. Returns the offset to add to the simulated position. */
  sample(): Vector2 {
    this.offset = {
      x: this.offset.x * (1 - CORRECTION_DECAY_PER_FRAME),
      y: this.offset.y * (1 - CORRECTION_DECAY_PER_FRAME),
    };
    if (Math.abs(this.offset.x) < 0.05) this.offset.x = 0;
    if (Math.abs(this.offset.y) < 0.05) this.offset.y = 0;
    return this.offset;
  }

  reset(): void {
    this.offset = { x: 0, y: 0 };
  }
}
