import { button } from './dom';

/** Host-only control that opens the field/sport picker. Sits above the joystick's catch area. */
export class SettingsButton {
  private readonly root: HTMLButtonElement;

  constructor(parent: HTMLElement, onClick: () => void) {
    this.root = button('⚙', 'settings-button', onClick);
    this.root.setAttribute('aria-label', 'Game settings');
    parent.append(this.root);
  }

  destroy(): void {
    this.root.remove();
  }
}
