import { button, el } from './dom';

/** Small run status and cancel control kept visible while an offline practice is active. */
export class PlaybookPracticeHud {
  private readonly root: HTMLElement;
  private readonly timerText: HTMLElement;

  constructor(parent: HTMLElement, playName: string, playerLabel: string, onCancel: () => void) {
    this.root = el('div', 'playbook-practice-hud');
    this.timerText = el('span', 'playbook-practice-timer', '0.0s');
    this.root.append(
      el('strong', 'playbook-practice-title', `PRACTICING ${playName} · ${playerLabel}`),
      this.timerText,
      button('Cancel', 'text-button', onCancel),
    );
    parent.append(this.root);
  }

  setElapsed(elapsedMs: number): void {
    this.timerText.textContent = `${Math.max(0, elapsedMs / 1000).toFixed(1)}s`;
  }

  destroy(): void {
    this.root.remove();
  }
}
