import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  MAX_PLAYERS,
  PLAYER_RADIUS,
} from '../config/constants';
import type { Vector2 } from './types';

const CENTER_X = ARENA_WIDTH / 2;
const CENTER_Y = ARENA_HEIGHT / 2;
const SPAWN_RING_RADIUS = Math.min(ARENA_WIDTH, ARENA_HEIGHT) * 0.3;

/**
 * Deterministic spawn ring. At 20 slots the chord between neighbours is ~187px, comfortably
 * clear of the 48px needed to keep two players from overlapping.
 */
export const SPAWN_POINTS: readonly Vector2[] = Array.from({ length: MAX_PLAYERS }, (_, slot) => {
  const angle = (slot / MAX_PLAYERS) * Math.PI * 2;
  return {
    x: CENTER_X + Math.cos(angle) * SPAWN_RING_RADIUS,
    y: CENTER_Y + Math.sin(angle) * SPAWN_RING_RADIUS,
  };
});

export function spawnPointForSlot(slot: number): Vector2 {
  const point = SPAWN_POINTS[((slot % MAX_PLAYERS) + MAX_PLAYERS) % MAX_PLAYERS];
  return point ?? { x: CENTER_X, y: CENTER_Y };
}

export const MIN_SPAWN_SEPARATION = PLAYER_RADIUS * 2;
