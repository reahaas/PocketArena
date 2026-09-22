import type { Vector2 } from '../game/types';

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Replaces NaN/Infinity with a fallback. Used at every untrusted numeric boundary. */
export function sanitizeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Scales the vector down when its length exceeds `max`, but leaves shorter vectors untouched.
 * This is what makes diagonals correct while preserving analogue partial-tilt on a joystick —
 * unconditional normalisation would make a half-tilt run at full speed.
 */
export function clampMagnitude(v: Vector2, max: number): Vector2 {
  const lengthSquared = v.x * v.x + v.y * v.y;
  if (lengthSquared <= max * max || lengthSquared === 0) return { x: v.x, y: v.y };
  const scale = max / Math.sqrt(lengthSquared);
  return { x: v.x * scale, y: v.y * scale };
}

/**
 * Converts a raw stick offset into a normalised input vector.
 * Output ramps from 0 at the deadzone edge to 1 at the stick radius, so there is no
 * discontinuity where the deadzone ends.
 */
export function applyDeadzone(offset: Vector2, radius: number, deadzone: number): Vector2 {
  const length = Math.hypot(offset.x, offset.y);
  if (length === 0) return { x: 0, y: 0 };

  const normalized = length / radius;
  if (normalized <= deadzone) return { x: 0, y: 0 };

  const scaled = Math.min((normalized - deadzone) / (1 - deadzone), 1);
  return { x: (offset.x / length) * scaled, y: (offset.y / length) * scaled };
}
