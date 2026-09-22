import { el } from './dom';

export interface DebugStats {
  role: 'host' | 'client';
  connection: string;
  tick: number;
  rttMs: number;
  sequence: number;
  lastAck: number;
  players: number;
  snapshotHz: number;
}

export function isDebugEnabled(): boolean {
  return new URLSearchParams(window.location.search).get('debug') === '1';
}

export function botCount(): number {
  const raw = new URLSearchParams(window.location.search).get('bots');
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.min(19, Math.trunc(value))) : 0;
}

/** Hidden unless `?debug=1`. This is the only place technical terminology may appear. */
export class DebugOverlay {
  private readonly root: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = el('pre', 'debug-overlay');
    parent.append(this.root);
  }

  update(stats: DebugStats): void {
    this.root.textContent = [
      `role      ${stats.role}`,
      `state     ${stats.connection}`,
      `tick      ${stats.tick}`,
      `rtt       ${stats.rttMs.toFixed(0)} ms`,
      `seq       ${stats.sequence}`,
      `ack       ${stats.lastAck}`,
      `players   ${stats.players}`,
      `snapshots ${stats.snapshotHz.toFixed(1)} Hz`,
    ].join('\n');
  }

  destroy(): void {
    this.root.remove();
  }
}
