import { describe, expect, it } from 'vitest';

import { JOYSTICK_DEADZONE, JOYSTICK_RADIUS } from '../src/config/constants';
import { applyDeadzone, clampMagnitude } from '../src/utils/math';

const R = JOYSTICK_RADIUS;

describe('applyDeadzone', () => {
  it('returns exactly zero inside the dead zone', () => {
    const inside = applyDeadzone({ x: R * JOYSTICK_DEADZONE * 0.5, y: 0 }, R, JOYSTICK_DEADZONE);
    expect(inside).toEqual({ x: 0, y: 0 });
  });

  it('ramps from zero at the dead zone edge rather than jumping to the threshold', () => {
    const justOutside = applyDeadzone(
      { x: R * (JOYSTICK_DEADZONE + 0.01), y: 0 },
      R,
      JOYSTICK_DEADZONE,
    );
    expect(justOutside.x).toBeGreaterThan(0);
    expect(justOutside.x).toBeLessThan(0.05);
  });

  it('reaches full deflection at the stick radius', () => {
    const full = applyDeadzone({ x: R, y: 0 }, R, JOYSTICK_DEADZONE);
    expect(full.x).toBeCloseTo(1, 6);
  });

  it('normalises diagonals to the same magnitude as cardinals', () => {
    const cardinal = applyDeadzone({ x: R, y: 0 }, R, JOYSTICK_DEADZONE);
    const diagonal = applyDeadzone({ x: R, y: R }, R, JOYSTICK_DEADZONE);

    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(
      Math.hypot(cardinal.x, cardinal.y),
      6,
    );
  });

  it('never exceeds magnitude 1 even when dragged far past the base', () => {
    const overshoot = applyDeadzone({ x: R * 10, y: R * 10 }, R, JOYSTICK_DEADZONE);
    expect(Math.hypot(overshoot.x, overshoot.y)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('handles a zero offset without dividing by zero', () => {
    expect(applyDeadzone({ x: 0, y: 0 }, R, JOYSTICK_DEADZONE)).toEqual({ x: 0, y: 0 });
  });
});

describe('clampMagnitude', () => {
  it('leaves short vectors untouched', () => {
    expect(clampMagnitude({ x: 0.3, y: 0.4 }, 1)).toEqual({ x: 0.3, y: 0.4 });
  });

  it('scales long vectors down to the maximum', () => {
    const clamped = clampMagnitude({ x: 3, y: 4 }, 1);
    expect(Math.hypot(clamped.x, clamped.y)).toBeCloseTo(1, 6);
  });
});
