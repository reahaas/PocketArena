import { button, el } from './dom';

/** Small run status and cancel control kept visible while an offline practice is active. */
export class PlaybookPracticeHud {
  private readonly root: HTMLElement;
  private readonly timerText: HTMLElement;
  private readonly countdownText: HTMLElement;

  constructor(parent: HTMLElement, playName: string, playerLabel: string, onCancel: () => void) {
    this.root = el('div', 'playbook-practice-hud');
    this.timerText = el('span', 'playbook-practice-timer', '0.0s');
    this.root.append(
      el('strong', 'playbook-practice-title', `PRACTICING ${playName} · ${playerLabel}`),
      this.timerText,
      button('Cancel', 'text-button', onCancel),
    );
    this.countdownText = el('div', 'playbook-practice-countdown');
    this.root.append(this.countdownText);
    parent.append(this.root);
  }

  setElapsed(elapsedMs: number): void {
    const countdown = elapsedMs < 0 ? Math.ceil(-elapsedMs / 1000) : 0;
    this.countdownText.textContent = countdown > 0 ? String(countdown) : elapsedMs < 300 ? 'GO!' : '';
    this.timerText.textContent = `${Math.max(0, elapsedMs / 1000).toFixed(1)}s`;
  }

  destroy(): void {
    this.root.remove();
  }
}
