import { describe, expect, it } from 'vitest';

import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  MAX_INPUT_DT,
  PLAYER_RADIUS,
  PLAYER_SPEED,
} from '../src/config/constants';
import { GameSimulation, stepPlayer } from '../src/game/GameSimulation';
import type { PlayerState } from '../src/game/types';

function player(x = 500, y = 500): PlayerState {
  return { id: 'p', slot: 0, x, y, vx: 0, vy: 0 };
}

describe('stepPlayer', () => {
  it('is frame-rate independent', () => {
    const input = { x: 1, y: 0 };

    const oneBigStep = stepPlayer(player(), input, 0.1);

    let many = player();
    for (let i = 0; i < 10; i++) many = stepPlayer(many, input, 0.01);

    expect(many.x).toBeCloseTo(oneBigStep.x, 6);
    expect(many.y).toBeCloseTo(oneBigStep.y, 6);
  });

  it('does not let diagonals move faster than cardinals', () => {
    const cardinal = stepPlayer(player(), { x: 1, y: 0 }, 0.1);
    const diagonal = stepPlayer(player(), { x: 1, y: 1 }, 0.1);

    const cardinalDistance = Math.hypot(cardinal.x - 500, cardinal.y - 500);
    const diagonalDistance = Math.hypot(diagonal.x - 500, diagonal.y - 500);

    expect(diagonalDistance).toBeCloseTo(cardinalDistance, 6);
  });

  it('preserves analogue partial tilt instead of normalising everything to full speed', () => {
    const full = stepPlayer(player(), { x: 1, y: 0 }, 0.1);
    const half = stepPlayer(player(), { x: 0.5, y: 0 }, 0.1);

    expect(half.x - 500).toBeCloseTo(PLAYER_SPEED * 0.5 * 0.1, 6);
    expect(half.x - 500).toBeCloseTo((full.x - 500) / 2, 6);
  });

  it('clamps the player inside the arena on every edge', () => {
    const left = stepPlayer(player(PLAYER_RADIUS + 1, 500), { x: -1, y: 0 }, 1);
    const right = stepPlayer(player(ARENA_WIDTH - PLAYER_RADIUS - 1, 500), { x: 1, y: 0 }, 1);
    const top = stepPlayer(player(500, PLAYER_RADIUS + 1), { x: 0, y: -1 }, 1);
    const bottom = stepPlayer(player(500, ARENA_HEIGHT - PLAYER_RADIUS - 1), { x: 0, y: 1 }, 1);

    expect(left.x).toBe(PLAYER_RADIUS);
    expect(right.x).toBe(ARENA_WIDTH - PLAYER_RADIUS);
    expect(top.y).toBe(PLAYER_RADIUS);
    expect(bottom.y).toBe(ARENA_HEIGHT - PLAYER_RADIUS);
  });

  it('clamps a hostile delta so one input cannot teleport a player', () => {
    const cheated = stepPlayer(player(), { x: 1, y: 0 }, 10_000);
    const legitimate = stepPlayer(player(), { x: 1, y: 0 }, MAX_INPUT_DT);
    expect(cheated.x).toBeCloseTo(legitimate.x, 6);
  });

  it('never produces NaN from a zero-length input', () => {
    const result = stepPlayer(player(), { x: 0, y: 0 }, 0.05);
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
  });
});

describe('GameSimulation', () => {
  it('adds, steps and removes players', () => {
    const sim = new GameSimulation();
    sim.addPlayer('a', 0, 100, 100);

    expect(sim.size).toBe(1);
    sim.step('a', { x: 1, y: 0 }, 0.1);
    expect(sim.getPlayer('a')!.x).toBeGreaterThan(100);

    expect(sim.removePlayer('a')).toBe(true);
    expect(sim.size).toBe(0);
  });

  it('ignores steps for unknown players', () => {
    const sim = new GameSimulation();
    expect(sim.step('missing', { x: 1, y: 0 }, 0.1)).toBeUndefined();
  });
});
