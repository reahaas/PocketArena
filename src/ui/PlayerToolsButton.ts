import { button } from './dom';

/** Available to every player (host included): opens the number-picker and personal draw tools. */
export class PlayerToolsButton {
  private readonly root: HTMLButtonElement;

  constructor(parent: HTMLElement, onClick: () => void) {
    this.root = button('👤', 'player-tools-button', onClick);
    this.root.setAttribute('aria-label', 'Player tools');
    parent.append(this.root);
  }

  destroy(): void {
    this.root.remove();
  }
}
