import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  MAX_INPUT_DT,
  PLAYER_RADIUS,
  PLAYER_SPEED,
} from '../config/constants';
import { clamp, clampMagnitude } from '../utils/math';
import type { PlayerId, PlayerState, Vector2 } from './types';

/**
 * The single source of truth for movement. The host simulation, client-side prediction and
 * reconciliation replay all call this exact function — a second copy of this maths is the
 * classic cause of host/client drift.
 */
export function stepPlayer(state: Readonly<PlayerState>, input: Vector2, dt: number): PlayerState {
  const step = clamp(dt, 0, MAX_INPUT_DT);
  const move = clampMagnitude(input, 1);

  const vx = move.x * PLAYER_SPEED;
  const vy = move.y * PLAYER_SPEED;

  return {
    id: state.id,
    slot: state.slot,
    x: clamp(state.x + vx * step, PLAYER_RADIUS, ARENA_WIDTH - PLAYER_RADIUS),
    y: clamp(state.y + vy * step, PLAYER_RADIUS, ARENA_HEIGHT - PLAYER_RADIUS),
    vx,
    vy,
  };
}

export class GameSimulation {
  private readonly players = new Map<PlayerId, PlayerState>();

  addPlayer(id: PlayerId, slot: number, x: number, y: number): PlayerState {
    const player: PlayerState = { id, slot, x, y, vx: 0, vy: 0 };
    this.players.set(id, player);
    return player;
  }

  upsertPlayer(state: PlayerState): PlayerState {
    this.players.set(state.id, { ...state });
    return this.players.get(state.id)!;
  }

  removePlayer(id: PlayerId): boolean {
    return this.players.delete(id);
  }

  getPlayer(id: PlayerId): PlayerState | undefined {
    return this.players.get(id);
  }

  has(id: PlayerId): boolean {
    return this.players.has(id);
  }

  get size(): number {
    return this.players.size;
  }

  /** Advances one player and stores the result. Returns undefined for unknown ids. */
  step(id: PlayerId, input: Vector2, dt: number): PlayerState | undefined {
    const current = this.players.get(id);
    if (!current) return undefined;

    const next = stepPlayer(current, input, dt);
    this.players.set(id, next);
    return next;
  }

  values(): IterableIterator<PlayerState> {
    return this.players.values();
  }

  snapshot(): PlayerState[] {
    return [...this.players.values()].map((p) => ({ ...p }));
  }

  clear(): void {
    this.players.clear();
  }
}
