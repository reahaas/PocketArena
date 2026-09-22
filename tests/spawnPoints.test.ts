import { describe, expect, it } from 'vitest';

import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  MAX_PLAYERS,
  PLAYER_RADIUS,
} from '../src/config/constants';
import { MIN_SPAWN_SEPARATION, SPAWN_POINTS, spawnPointForSlot } from '../src/game/SpawnPoints';

describe('spawn points', () => {
  it('provides one per player slot', () => {
    expect(SPAWN_POINTS).toHaveLength(MAX_PLAYERS);
  });

  it('never spawns anyone at the origin', () => {
    for (const point of SPAWN_POINTS) {
      expect(Math.hypot(point.x, point.y)).toBeGreaterThan(0);
    }
  });

  it('keeps every pair of players clear of each other', () => {
    for (let i = 0; i < SPAWN_POINTS.length; i++) {
      for (let j = i + 1; j < SPAWN_POINTS.length; j++) {
        const a = SPAWN_POINTS[i]!;
        const b = SPAWN_POINTS[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(MIN_SPAWN_SEPARATION);
      }
    }
  });

  it('places every spawn inside the arena bounds', () => {
    for (const point of SPAWN_POINTS) {
      expect(point.x).toBeGreaterThanOrEqual(PLAYER_RADIUS);
      expect(point.y).toBeGreaterThanOrEqual(PLAYER_RADIUS);
      expect(point.x).toBeLessThanOrEqual(ARENA_WIDTH - PLAYER_RADIUS);
      expect(point.y).toBeLessThanOrEqual(ARENA_HEIGHT - PLAYER_RADIUS);
    }
  });

  it('is deterministic', () => {
    expect(spawnPointForSlot(3)).toEqual(spawnPointForSlot(3));
  });

  it('wraps out-of-range slots instead of returning undefined', () => {
    expect(spawnPointForSlot(MAX_PLAYERS)).toEqual(spawnPointForSlot(0));
    expect(spawnPointForSlot(-1)).toEqual(spawnPointForSlot(MAX_PLAYERS - 1));
  });
});
