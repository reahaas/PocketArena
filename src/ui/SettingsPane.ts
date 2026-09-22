import { SPORTS, SPORT_LABELS } from '../config/constants';
import type { SportType } from '../config/constants';
import { button, el } from './dom';

export interface SettingsPaneHandlers {
  onSelect: (sport: SportType) => void;
  onClose: () => void;
}

/** Host-only field picker; the chosen sport is broadcast to every connected player. */
export class SettingsPane {
  private readonly root: HTMLElement;
  private readonly optionButtons = new Map<SportType, HTMLButtonElement>();

  constructor(parent: HTMLElement, current: SportType, handlers: SettingsPaneHandlers) {
    this.root = el('div', 'settings-pane');

    const options = el('div', 'settings-options');
    for (const sport of SPORTS) {
      const optionButton = button(SPORT_LABELS[sport], 'secondary-button', () =>
        handlers.onSelect(sport),
      );
      this.optionButtons.set(sport, optionButton);
      options.append(optionButton);
    }

    this.root.append(
      el('h2', 'share-title', 'GAME FIELD'),
      options,
      button('Close', 'text-button', () => handlers.onClose()),
    );

    parent.append(this.root);
    this.setActive(current);
  }

  setActive(sport: SportType): void {
    for (const [key, optionButton] of this.optionButtons) {
      optionButton.classList.toggle('is-active', key === sport);
    }
  }

  destroy(): void {
    this.root.remove();
  }
}
