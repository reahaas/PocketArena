import { button } from './dom';

/**
 * Browser chrome eats a lot of a landscape phone. Fullscreen roughly doubles the usable
 * board area, so it is worth a one-tap toggle.
 */
export class FullscreenButton {
  private readonly root: HTMLButtonElement;

  constructor(parent: HTMLElement, private readonly toggle: () => void) {
    this.root = button('⛶', 'fullscreen-button', () => {
      this.toggle();
      // The state flips asynchronously, so re-read it once the browser has applied it.
      setTimeout(() => this.sync(), 150);
    });
    parent.append(this.root);
    this.sync();
  }

  sync(isFullscreen = document.fullscreenElement !== null): void {
    this.root.classList.toggle('is-active', isFullscreen);
    this.root.setAttribute(
      'aria-label',
      isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen',
    );
    this.root.setAttribute('aria-pressed', String(isFullscreen));
  }

  destroy(): void {
    this.root.remove();
  }
}
