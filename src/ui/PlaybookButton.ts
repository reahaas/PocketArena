import { button } from './dom';

/** Host-only: opens the playbook library (saved plays, new/run/export/import). */
export class PlaybookButton {
  private readonly root: HTMLButtonElement;

  constructor(parent: HTMLElement, onClick: () => void) {
    this.root = button('📋', 'playbook-button', onClick);
    this.root.setAttribute('aria-label', 'Playbook');
    parent.append(this.root);
  }

  destroy(): void {
    this.root.remove();
  }
}
