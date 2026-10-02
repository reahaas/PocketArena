import { ARENA_HEIGHT, ARENA_WIDTH, PLAYER_SPEED } from '../config/constants';
import type { TeamId } from '../config/constants';
import type { PlaybookStep } from '../networking/NetworkProtocol';
import { clamp, lerp } from '../utils/math';
import type { Vector2 } from './types';

/** Fastest legal straight-line travel time at the same top speed used by the simulation. */
export function minimumPlaybookStepDurationMs(
  from: Vector2,
  to: Vector2,
): number {
  const distancePx = Math.hypot(to.x - from.x, to.y - from.y);
  // Step times are authored in 0.01s increments; round upward so the displayed value is never
  // shorter than the travel time implied by PLAYER_SPEED.
  return Math.max(10, Math.ceil((distancePx / PLAYER_SPEED) * 100) * 10);
}

/**
 * Where an assignment's player is "supposed" to be at `elapsedMs` since the play started.
 * Steps are explicit (start time + duration + from/to position), so between two steps — or
 * before the first one starts — the player holds at the nearest known position rather than
 * sliding early toward whatever comes next. Shared by the host (grading) and the renderer (the
 * ghost target / preview), so they can never disagree.
 */
export function expectedPlaybookPosition(
  steps: readonly PlaybookStep[],
  elapsedMs: number,
): Vector2 | null {
  if (steps.length === 0) return null;

  const sorted = [...steps].sort((a, b) => a.startMs - b.startMs);
  const first = sorted[0]!;
  if (elapsedMs <= first.startMs) return { x: first.fromX, y: first.fromY };

  let lastEnd = { x: first.fromX, y: first.fromY };
  for (const step of sorted) {
    if (elapsedMs < step.startMs) return lastEnd;

    const endMs = step.startMs + step.durationMs;
    if (elapsedMs <= endMs) {
      const span = step.durationMs <= 0 ? 1 : step.durationMs;
      const t = clamp((elapsedMs - step.startMs) / span, 0, 1);
      return { x: lerp(step.fromX, step.toX, t), y: lerp(step.fromY, step.toY, t) };
    }

    lastEnd = { x: step.toX, y: step.toY };
  }

  return lastEnd;
}

/**
 * Lines a team up on its own side of the field, evenly spaced top-to-bottom, so a freshly added
 * editor player is visible on the field immediately — even before they have any steps.
 */
export function defaultPlaybookEditorPosition(
  team: TeamId,
  indexInTeam: number,
  countInTeam: number,
): Vector2 {
  const x = team === 'A' ? ARENA_WIDTH * 0.25 : ARENA_WIDTH * 0.75;
  const y = (ARENA_HEIGHT * (indexInTeam + 1)) / (countInTeam + 1);
  return { x, y };
}
