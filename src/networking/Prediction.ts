import { INPUT_BUFFER_SIZE } from '../config/constants';
import { stepPlayer } from '../game/GameSimulation';
import type { PlayerState, Vector2 } from '../game/types';

export interface PendingInput {
  sequence: number;
  input: Vector2;
  dt: number;
}

/**
 * Applies local input immediately and remembers it so it can be replayed after the host
 * acknowledges (spec §10). The local player never waits for the network.
 */
export class Prediction {
  private readonly pending: PendingInput[] = [];
  private sequence = 0;
  private state: PlayerState;

  constructor(initial: PlayerState) {
    this.state = { ...initial };
  }

  get current(): PlayerState {
    return this.state;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get lastSequence(): number {
    return this.sequence;
  }

  /** Returns the sequence number to put on the wire alongside this input. */
  apply(input: Vector2, dt: number): PendingInput {
    this.sequence += 1;
    const record: PendingInput = { sequence: this.sequence, input: { ...input }, dt };

    this.state = stepPlayer(this.state, input, dt);
    this.pending.push(record);

    // Overflow means the host has gone quiet for seconds; the oldest inputs are unrecoverable.
    if (this.pending.length > INPUT_BUFFER_SIZE) this.pending.shift();

    return record;
  }

  /** Drops acknowledged inputs and returns the ones still in flight, oldest first. */
  drainAcknowledged(ack: number): PendingInput[] {
    while (this.pending.length > 0 && this.pending[0]!.sequence <= ack) {
      this.pending.shift();
    }
    return this.pending;
  }

  setState(state: PlayerState): void {
    this.state = { ...state };
  }

  reset(state: PlayerState): void {
    this.pending.length = 0;
    this.state = { ...state };
  }
}
