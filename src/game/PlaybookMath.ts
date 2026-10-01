import type { PlaybookWaypoint } from '../networking/NetworkProtocol';
import { clamp, lerp } from '../utils/math';
import type { Vector2 } from './types';

/**
 * Where an assignment's player is "supposed" to be at `elapsedMs` since the play started —
 * linear interpolation between the two waypoints bracketing that time. Shared by the host
 * (grading) and the renderer (the ghost target), so they can never disagree.
 */
export function expectedPlaybookPosition(
  waypoints: readonly PlaybookWaypoint[],
  elapsedMs: number,
): Vector2 | null {
  if (waypoints.length === 0) return null;

  const first = waypoints[0]!;
  if (elapsedMs <= first.atMs) return { x: first.x, y: first.y };

  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i]!;
    const to = waypoints[i + 1]!;
    if (elapsedMs > to.atMs) continue;
    const span = to.atMs - from.atMs;
    const t = span <= 0 ? 1 : clamp((elapsedMs - from.atMs) / span, 0, 1);
    return { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) };
  }

  const last = waypoints[waypoints.length - 1]!;
  return { x: last.x, y: last.y };
}
