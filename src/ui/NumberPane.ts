import { NUMBER_MAX, NUMBER_MIN } from '../config/constants';
import { button, el } from './dom';

export interface NumberPaneHandlers {
  onSelect: (number: number) => void;
  onClose: () => void;
}

/** Lets a player pick any jersey number the host has not already handed to a teammate. */
export class NumberPane {
  private readonly root: HTMLElement;
  private readonly buttons = new Map<number, HTMLButtonElement>();

  constructor(
    parent: HTMLElement,
    current: number,
    taken: ReadonlySet<number>,
    handlers: NumberPaneHandlers,
  ) {
    this.root = el('div', 'settings-pane number-pane');

    const grid = el('div', 'number-grid');
    for (let n = NUMBER_MIN; n <= NUMBER_MAX; n++) {
      const numberButton = button(String(n), 'number-button', () => handlers.onSelect(n));
      this.buttons.set(n, numberButton);
      grid.append(numberButton);
    }

    this.root.append(
      el('h2', 'share-title', 'CHOOSE YOUR NUMBER'),
      grid,
      button('Close', 'text-button', () => handlers.onClose()),
    );

    parent.append(this.root);
    this.update(current, taken);
  }

  /** Re-applied whenever the roster changes — a teammate's pick, or a grace period lapsing. */
  update(current: number, taken: ReadonlySet<number>): void {
    for (const [n, numberButton] of this.buttons) {
      const unavailable = n !== current && taken.has(n);
      numberButton.disabled = unavailable;
      numberButton.classList.toggle('is-disabled', unavailable);
      numberButton.classList.toggle('is-active', n === current);
    }
  }

  destroy(): void {
    this.root.remove();
  }
}
