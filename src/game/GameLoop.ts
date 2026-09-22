export interface GameLoopOptions {
  tickMs: number;
  maxCatchupTicks: number;
  /** Fixed-timestep simulation step. `dt` is always `tickMs / 1000`. */
  onTick: (dt: number) => void;
  /** Called once per animation frame. `alpha` is progress into the pending tick, 0..1. */
  onFrame?: (alpha: number, frameMs: number) => void;
}

/**
 * Fixed-timestep accumulator driven by requestAnimationFrame, deliberately independent of
 * Phaser's update loop so simulation, networking and rendering keep separate clocks (spec §15).
 */
export class GameLoop {
  private running = false;
  private handle = 0;
  private accumulator = 0;
  private lastTime = 0;

  constructor(private readonly options: GameLoopOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.handle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.handle);
  }

  /** Drops accumulated time without simulating it — used when resuming from a paused tab. */
  resetClock(): void {
    this.lastTime = performance.now();
    this.accumulator = 0;
  }

  get isRunning(): boolean {
    return this.running;
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.handle = requestAnimationFrame(this.frame);

    const { tickMs, maxCatchupTicks, onTick, onFrame } = this.options;
    const frameMs = now - this.lastTime;
    this.lastTime = now;
    this.accumulator += frameMs;

    let ticks = 0;
    while (this.accumulator >= tickMs && ticks < maxCatchupTicks) {
      onTick(tickMs / 1000);
      this.accumulator -= tickMs;
      ticks++;
    }

    // Spiral-of-death guard: discard a backlog we could not work through this frame.
    if (this.accumulator >= tickMs) this.accumulator = 0;

    onFrame?.(this.accumulator / tickMs, frameMs);
  };
}
