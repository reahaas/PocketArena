import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  EXTRAP_MAX_MS,
  PLAYER_RADIUS,
  SNAPSHOT_BUFFER_SIZE,
} from '../config/constants';
import type { Vector2 } from '../game/types';
import { clamp, lerp } from '../utils/math';

interface Sample {
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Estimates "what time is it on the host right now" from snapshot timestamps.
 * The least-delayed sample is the most accurate, so the offset snaps up and drifts down slowly.
 */
export class ServerClock {
  private offset: number | null = null;

  sync(serverTimeMs: number, localNowMs: number): void {
    const sample = serverTimeMs - localNowMs;
    if (this.offset === null || sample > this.offset) {
      this.offset = sample;
      return;
    }
    this.offset = lerp(this.offset, sample, 0.01);
  }

  now(localNowMs: number): number {
    return localNowMs + (this.offset ?? 0);
  }

  get synced(): boolean {
    return this.offset !== null;
  }
}

/**
 * Buffers snapshots for one remote player and produces a position for any render time.
 * Interpolates between bracketing samples; extrapolates only when the buffer has starved
 * (decision A2), and never for longer than EXTRAP_MAX_MS.
 */
export class RemoteInterpolator {
  private readonly samples: Sample[] = [];

  push(serverTimeMs: number, x: number, y: number, vx: number, vy: number): void {
    const newest = this.samples[this.samples.length - 1];
    // The unreliable channel reorders; anything not newer than what we have is noise.
    if (newest && serverTimeMs <= newest.t) return;

    this.samples.push({ t: serverTimeMs, x, y, vx, vy });
    if (this.samples.length > SNAPSHOT_BUFFER_SIZE) this.samples.shift();
  }

  sample(renderTimeMs: number): Vector2 {
    const samples = this.samples;
    if (samples.length === 0) return { x: 0, y: 0 };

    const oldest = samples[0]!;
    const newest = samples[samples.length - 1]!;

    if (renderTimeMs <= oldest.t) return { x: oldest.x, y: oldest.y };

    if (renderTimeMs >= newest.t) {
      const aheadMs = Math.min(renderTimeMs - newest.t, EXTRAP_MAX_MS);
      return clampToArena(newest.x + (newest.vx * aheadMs) / 1000, newest.y + (newest.vy * aheadMs) / 1000);
    }

    for (let i = samples.length - 1; i > 0; i--) {
      const b = samples[i]!;
      const a = samples[i - 1]!;
      if (renderTimeMs >= a.t && renderTimeMs <= b.t) {
        const span = b.t - a.t;
        const t = span === 0 ? 1 : (renderTimeMs - a.t) / span;
        return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
      }
    }

    return { x: newest.x, y: newest.y };
  }

  get hasSamples(): boolean {
    return this.samples.length > 0;
  }

  /** Drops samples that can no longer be referenced by any future render time. */
  prune(renderTimeMs: number): void {
    while (this.samples.length > 2 && this.samples[1]!.t < renderTimeMs) {
      this.samples.shift();
    }
  }

  reset(): void {
    this.samples.length = 0;
  }
}

function clampToArena(x: number, y: number): Vector2 {
  return {
    x: clamp(x, PLAYER_RADIUS, ARENA_WIDTH - PLAYER_RADIUS),
    y: clamp(y, PLAYER_RADIUS, ARENA_HEIGHT - PLAYER_RADIUS),
  };
}
