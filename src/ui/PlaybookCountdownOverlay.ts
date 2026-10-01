import { el } from './dom';

const TICK_MS = 100;
/** How long the "GO!" flash lingers before the overlay clears itself. */
const GO_LINGER_MS = 600;

/**
 * Shown to every player (host included) between a play's launch and its grading start.
 * Counts down using the device's own clock — already converted to local time by the caller — so
 * it stays in sync with the host without any extra network chatter.
 */
export class PlaybookCountdownOverlay {
  private readonly root: HTMLElement;
  private readonly text: HTMLElement;
  private timer: ReturnType<typeof setInterval> | null = null;
  private doneCalled = false;

  constructor(
    parent: HTMLElement,
    playName: string,
    startAtLocalMs: number,
    private readonly onDone: () => void,
  ) {
    this.root = el('div', 'playbook-countdown');
    this.text = el('p', 'playbook-countdown-text', '');
    this.root.append(el('h2', 'share-title', playName.toUpperCase()), this.text);
    parent.append(this.root);

    const tick = (): void => {
      const remaining = startAtLocalMs - performance.now();
      if (remaining <= 0) {
        this.text.textContent = 'GO!';
        this.stopTimer();
        this.fireDone();
        setTimeout(() => this.destroy(), GO_LINGER_MS);
        return;
      }
      this.text.textContent = String(Math.ceil(remaining / 1000));
    };

    tick();
    this.timer = setInterval(tick, TICK_MS);
  }

  destroy(): void {
    this.stopTimer();
    this.fireDone();
    this.root.remove();
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private fireDone(): void {
    if (this.doneCalled) return;
    this.doneCalled = true;
    this.onDone();
  }
}
