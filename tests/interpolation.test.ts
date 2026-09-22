import { describe, expect, it } from 'vitest';

import { EXTRAP_MAX_MS, PLAYER_SPEED } from '../src/config/constants';
import { RemoteInterpolator, ServerClock } from '../src/networking/Interpolation';

describe('RemoteInterpolator', () => {
  it('interpolates between two snapshots', () => {
    const interpolator = new RemoteInterpolator();
    interpolator.push(1000, 100, 100, 0, 0);
    interpolator.push(1100, 200, 100, 0, 0);

    expect(interpolator.sample(1050).x).toBeCloseTo(150, 6);
    expect(interpolator.sample(1000).x).toBeCloseTo(100, 6);
    expect(interpolator.sample(1100).x).toBeCloseTo(200, 6);
  });

  it('moves monotonically across the interval', () => {
    const interpolator = new RemoteInterpolator();
    interpolator.push(0, 0, 0, 0, 0);
    interpolator.push(100, 100, 0, 0, 0);

    let previous = -Infinity;
    for (let t = 0; t <= 100; t += 5) {
      const x = interpolator.sample(t).x;
      expect(x).toBeGreaterThanOrEqual(previous);
      previous = x;
    }
  });

  it('never overshoots the bracketing samples', () => {
    const interpolator = new RemoteInterpolator();
    interpolator.push(0, 100, 100, 0, 0);
    interpolator.push(100, 200, 100, 0, 0);

    for (let t = 0; t <= 100; t += 10) {
      const { x } = interpolator.sample(t);
      expect(x).toBeGreaterThanOrEqual(100);
      expect(x).toBeLessThanOrEqual(200);
    }
  });

  it('extrapolates from the last known velocity when the buffer starves', () => {
    const interpolator = new RemoteInterpolator();
    interpolator.push(0, 500, 500, PLAYER_SPEED, 0);

    const after50ms = interpolator.sample(50);
    expect(after50ms.x).toBeCloseTo(500 + PLAYER_SPEED * 0.05, 6);
  });

  it('stops extrapolating at the configured cap', () => {
    const interpolator = new RemoteInterpolator();
    interpolator.push(0, 500, 500, PLAYER_SPEED, 0);

    const atCap = interpolator.sample(EXTRAP_MAX_MS);
    const wayPastCap = interpolator.sample(EXTRAP_MAX_MS * 20);

    expect(wayPastCap.x).toBeCloseTo(atCap.x, 6);
  });

  it('does not extrapolate while real samples still bracket the render time', () => {
    const interpolator = new RemoteInterpolator();
    interpolator.push(0, 0, 0, PLAYER_SPEED * 10, 0);
    interpolator.push(100, 50, 0, PLAYER_SPEED * 10, 0);

    // Pure interpolation would give 25; extrapolation would run far ahead.
    expect(interpolator.sample(50).x).toBeCloseTo(25, 6);
  });

  it('ignores duplicate and out-of-order snapshots', () => {
    const interpolator = new RemoteInterpolator();
    interpolator.push(100, 100, 0, 0, 0);
    interpolator.push(200, 200, 0, 0, 0);

    interpolator.push(150, 0, 0, 0, 0); // late arrival on the unordered channel
    interpolator.push(200, 999, 0, 0, 0); // duplicate

    expect(interpolator.sample(200).x).toBeCloseTo(200, 6);
    expect(interpolator.sample(150).x).toBeCloseTo(150, 6);
  });

  it('holds the last position when it has only one sample and no velocity', () => {
    const interpolator = new RemoteInterpolator();
    interpolator.push(0, 42, 24, 0, 0);
    expect(interpolator.sample(9999)).toEqual({ x: 42, y: 24 });
  });

  it('reports having no samples before anything arrives', () => {
    expect(new RemoteInterpolator().hasSamples).toBe(false);
  });
});

describe('ServerClock', () => {
  it('estimates host time from a snapshot timestamp', () => {
    const clock = new ServerClock();
    clock.sync(10_000, 1_000);
    expect(clock.now(1_000)).toBeCloseTo(10_000, 6);
  });

  it('prefers the least delayed sample', () => {
    const clock = new ServerClock();
    clock.sync(10_000, 1_000); // offset 9000
    clock.sync(10_100, 1_200); // offset 8900, more delayed — should not win outright
    expect(clock.now(1_200)).toBeGreaterThan(10_090);
  });

  it('reports whether it has ever been synced', () => {
    const clock = new ServerClock();
    expect(clock.synced).toBe(false);
    clock.sync(1, 0);
    expect(clock.synced).toBe(true);
  });
});
