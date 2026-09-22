import type { ConnectionState } from '../networking/transport/Transport';
import { el } from './dom';

/** Deliberately free of networking jargon — players never see WebRTC/ICE/SDP (spec §30). */
const LABELS: Record<ConnectionState, string> = {
  DISCONNECTED: 'Disconnected',
  CONNECTING: 'Connecting...',
  CONNECTED: 'Connected',
  RECONNECTING: 'Reconnecting...',
  FAILED: 'Connection lost',
};

export class ConnectionIndicator {
  private readonly root: HTMLElement;
  private state: ConnectionState = 'CONNECTING';
  private paused = false;
  private onRetry: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'connection-indicator');
    this.root.addEventListener('click', () => {
      if (this.canRetry) this.onRetry?.();
    });
    parent.append(this.root);
    this.render();
  }

  set(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.render();
  }

  /** A paused host is not a connection problem, so it gets its own wording. */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.render();
  }

  /** Offers a one-tap way back into the game once the connection has actually dropped. */
  setRetryHandler(handler: (() => void) | null): void {
    this.onRetry = handler;
    this.render();
  }

  destroy(): void {
    this.root.remove();
  }

  private get canRetry(): boolean {
    if (!this.onRetry || this.paused) return false;
    return this.state === 'FAILED' || this.state === 'DISCONNECTED';
  }

  private render(): void {
    const label = this.paused ? 'Game paused' : LABELS[this.state];
    const retry = this.canRetry;

    this.root.textContent = retry ? `● ${label} — tap to rejoin` : `● ${label}`;
    this.root.dataset.state = this.paused ? 'paused' : this.state.toLowerCase();
    this.root.classList.toggle('is-actionable', retry);

    if (retry) {
      this.root.setAttribute('role', 'button');
      this.root.setAttribute('tabindex', '0');
    } else {
      this.root.removeAttribute('role');
      this.root.removeAttribute('tabindex');
    }
  }
}
