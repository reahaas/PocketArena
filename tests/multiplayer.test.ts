import { afterEach, describe, expect, it } from 'vitest';

import { MAX_PLAYERS, PLAYER_SPEED, SNAPSHOT_INTERVAL_MS } from '../src/config/constants';
import { Harness } from './harness/Harness';

/** How far one input advances a player, and so the natural unit of un-reconciled error. */
const ONE_INPUT_STEP_PX = (PLAYER_SPEED * SNAPSHOT_INTERVAL_MS) / 1000;

let harness: Harness;

afterEach(() => harness?.destroy());

function circularInput(index: number, step: number): { x: number; y: number } {
  const angle = index * 0.7 + step * 0.15;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

describe.each([2, 5, 10, MAX_PLAYERS])('a %i-player game', (total) => {
  const clientCount = total - 1;

  it('connects everyone and shows them to each other', () => {
    harness = new Harness();
    for (let i = 0; i < clientCount; i++) expect(harness.addClient()).not.toBeNull();

    harness.advance(3, () => ({ x: 0, y: 0 }));

    expect(harness.host.playerCount).toBe(total);
    for (const { client } of harness.clients) {
      expect(client.isReady).toBe(true);
      expect(client.playerCount).toBe(total);
    }
  });

  it('keeps every prediction converged while all of them move at once', () => {
    harness = new Harness();
    for (let i = 0; i < clientCount; i++) harness.addClient();

    harness.advance(120, circularInput);

    expect(harness.maxDivergence()).toBeLessThan(0.001);
  });
});

describe('joining a game that is already running', () => {
  it('places the newcomer at its spawn, never at the origin', () => {
    harness = new Harness();
    harness.addClient();
    harness.advance(40, circularInput);

    const latecomer = harness.addClient()!;
    const state = latecomer.client.localState!;

    expect(state.x).toBeGreaterThan(0);
    expect(state.y).toBeGreaterThan(0);
  });

  it('gives the newcomer everyone else\u2019s current positions immediately', () => {
    harness = new Harness();
    harness.addClient();
    harness.addClient();
    harness.advance(40, circularInput);

    const latecomer = harness.addClient()!;
    expect(latecomer.client.playerCount).toBe(4);
  });

  it('makes the newcomer visible to everyone already playing', () => {
    harness = new Harness();
    const existing = harness.addClient()!;
    harness.advance(10, circularInput);

    harness.addClient();
    harness.advance(2, circularInput);

    expect(existing.client.playerCount).toBe(3);
  });

  it('converges the latecomer without disturbing anyone else', () => {
    harness = new Harness();
    for (let i = 0; i < 5; i++) harness.addClient();
    harness.advance(50, circularInput);

    harness.addClient();
    harness.advance(50, circularInput);

    expect(harness.maxDivergence()).toBeLessThan(0.001);
  });
});

describe('degraded networks', () => {
  it('keeps the error bounded and re-syncs when 5% of packets are dropped', () => {
    harness = new Harness({ latencyMs: 0, jitterMs: 0, lossPercent: 5 });
    for (let i = 0; i < 4; i++) harness.addClient();

    // A dropped snapshot leaves the client legitimately ahead of the last acknowledged state.
    // What matters is that the gap stays small and never accumulates.
    let worst = 0;
    for (let i = 0; i < 40; i++) {
      harness.advance(5, circularInput);
      worst = Math.max(worst, harness.maxDivergence());
    }
    expect(worst).toBeLessThan(ONE_INPUT_STEP_PX * 5);

    harness.setLoss(0);
    harness.advance(5, circularInput);
    expect(harness.maxDivergence()).toBeLessThan(0.001);
  });

  it('does not drift over a long session', () => {
    harness = new Harness();
    for (let i = 0; i < 3; i++) harness.addClient();

    harness.advance(1200, circularInput);

    expect(harness.maxDivergence()).toBeLessThan(0.001);
  });
});
