import { describe, expect, it } from 'vitest';

import { INPUT_BUFFER_SIZE, SNAP_THRESHOLD_PX } from '../src/config/constants';
import { stepPlayer } from '../src/game/GameSimulation';
import type { PlayerState } from '../src/game/types';
import { Prediction } from '../src/networking/Prediction';
import {
  CorrectionSmoother,
  reconcile,
  replayInputs,
} from '../src/networking/Reconciliation';

function base(): PlayerState {
  return { id: 'p', slot: 0, x: 500, y: 500, vx: 0, vy: 0 };
}

describe('Prediction', () => {
  it('moves immediately without waiting for the host', () => {
    const prediction = new Prediction(base());
    prediction.apply({ x: 1, y: 0 }, 0.05);
    expect(prediction.current.x).toBeGreaterThan(500);
  });

  it('hands out monotonically increasing sequence numbers', () => {
    const prediction = new Prediction(base());
    const sequences = [1, 2, 3].map(() => prediction.apply({ x: 1, y: 0 }, 0.05).sequence);
    expect(sequences).toEqual([1, 2, 3]);
  });

  it('drops inputs the host has acknowledged', () => {
    const prediction = new Prediction(base());
    for (let i = 0; i < 5; i++) prediction.apply({ x: 1, y: 0 }, 0.05);

    const pending = prediction.drainAcknowledged(3);
    expect(pending.map((p) => p.sequence)).toEqual([4, 5]);
  });

  it('bounds the buffer so a silent host cannot exhaust memory', () => {
    const prediction = new Prediction(base());
    for (let i = 0; i < INPUT_BUFFER_SIZE + 50; i++) prediction.apply({ x: 1, y: 0 }, 0.01);
    expect(prediction.pendingCount).toBe(INPUT_BUFFER_SIZE);
  });
});

describe('replayInputs', () => {
  it('matches simulating the same inputs directly', () => {
    const prediction = new Prediction(base());
    const inputs = [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 1 },
    ];
    for (const input of inputs) prediction.apply(input, 0.05);

    let expected = base();
    for (const input of inputs) expected = stepPlayer(expected, input, 0.05);

    const replayed = replayInputs(base(), prediction.drainAcknowledged(0));
    expect(replayed.x).toBeCloseTo(expected.x, 9);
    expect(replayed.y).toBeCloseTo(expected.y, 9);
  });

  it('is a no-op when nothing is in flight', () => {
    const authoritative = { ...base(), x: 123, y: 456 };
    const replayed = replayInputs(authoritative, []);
    expect(replayed).toEqual(authoritative);
  });

  it('uses each input\u2019s own delta rather than a nominal one', () => {
    const pending = [
      { sequence: 1, input: { x: 1, y: 0 }, dt: 0.02 },
      { sequence: 2, input: { x: 1, y: 0 }, dt: 0.08 },
    ];
    const withRealDeltas = replayInputs(base(), pending);
    const withNominalDeltas = replayInputs(
      base(),
      pending.map((p) => ({ ...p, dt: 0.05 })),
    );
    expect(withRealDeltas.x).toBeCloseTo(withNominalDeltas.x, 9);
  });
});

describe('reconcile', () => {
  it('reports no error when the host agrees with the prediction', () => {
    const prediction = new Prediction(base());
    prediction.apply({ x: 1, y: 0 }, 0.05);

    const authoritative = stepPlayer(base(), { x: 1, y: 0 }, 0.05);
    const result = reconcile(authoritative, prediction.drainAcknowledged(1), prediction.current);

    expect(result.errorPx).toBeCloseTo(0, 6);
    expect(result.snapped).toBe(false);
  });

  it('replays unacknowledged inputs on top of the authoritative state', () => {
    const prediction = new Prediction(base());
    for (let i = 0; i < 5; i++) prediction.apply({ x: 1, y: 0 }, 0.05);

    // Host has only processed the first two inputs.
    let authoritative = base();
    for (let i = 0; i < 2; i++) authoritative = stepPlayer(authoritative, { x: 1, y: 0 }, 0.05);

    const result = reconcile(authoritative, prediction.drainAcknowledged(2), prediction.current);
    expect(result.errorPx).toBeCloseTo(0, 6);
    expect(result.state.x).toBeCloseTo(prediction.current.x, 6);
  });

  it('flags a large divergence for snapping', () => {
    const prediction = new Prediction(base());
    prediction.apply({ x: 1, y: 0 }, 0.05);

    const teleported = { ...base(), x: base().x + SNAP_THRESHOLD_PX * 3 };
    const result = reconcile(teleported, [], prediction.current);

    expect(result.snapped).toBe(true);
  });
});

describe('CorrectionSmoother', () => {
  it('decays a small correction to nothing', () => {
    const smoother = new CorrectionSmoother();
    smoother.absorb(20, -20, false);

    let offset = smoother.sample();
    expect(Math.hypot(offset.x, offset.y)).toBeGreaterThan(0);

    for (let i = 0; i < 200; i++) offset = smoother.sample();
    expect(offset).toEqual({ x: 0, y: 0 });
  });

  it('discards the offset entirely when the correction was snapped', () => {
    const smoother = new CorrectionSmoother();
    smoother.absorb(500, 500, true);
    expect(smoother.sample()).toEqual({ x: 0, y: 0 });
  });
});
