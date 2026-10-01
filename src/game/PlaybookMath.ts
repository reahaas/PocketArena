import type { PlaybookStep } from '../networking/NetworkProtocol';
import { clamp, lerp } from '../utils/math';
import type { Vector2 } from './types';

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
