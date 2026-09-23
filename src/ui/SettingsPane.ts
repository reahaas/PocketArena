import { SPORTS, SPORT_LABELS } from '../config/constants';
import type { SportType } from '../config/constants';
import { button, el } from './dom';

export interface SettingsPaneHandlers {
  onSelect: (sport: SportType) => void;
  onToggleDrawEnabled: (enabled: boolean) => void;
  onClearAll: () => void;
  onClose: () => void;
}

/** Host-only field picker plus tactics-board administration. */
export class SettingsPane {
  private readonly root: HTMLElement;
  private readonly optionButtons = new Map<SportType, HTMLButtonElement>();
  private readonly drawEnabledButton: HTMLButtonElement;
  private drawEnabled: boolean;

  constructor(
    parent: HTMLElement,
    current: SportType,
    drawEnabled: boolean,
    handlers: SettingsPaneHandlers,
  ) {
    this.root = el('div', 'settings-pane');

    const options = el('div', 'settings-options');
    for (const sport of SPORTS) {
      const optionButton = button(SPORT_LABELS[sport], 'secondary-button', () =>
        handlers.onSelect(sport),
      );
      this.optionButtons.set(sport, optionButton);
      options.append(optionButton);
    }

    this.drawEnabledButton = button('', 'secondary-button', () =>
      handlers.onToggleDrawEnabled(!this.drawEnabled),
    );
    this.drawEnabled = drawEnabled;
    this.renderDrawEnabledLabel();

    this.root.append(
      el('h2', 'share-title', 'GAME FIELD'),
      options,
      el('h2', 'share-title', 'TACTICS BOARD'),
      this.drawEnabledButton,
      button('Clear ALL Drawings', 'secondary-button', () => handlers.onClearAll()),
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

  setDrawEnabled(enabled: boolean): void {
    this.drawEnabled = enabled;
    this.renderDrawEnabledLabel();
  }

  private renderDrawEnabledLabel(): void {
    this.drawEnabledButton.textContent = this.drawEnabled
      ? 'Drawing: ON for everyone'
      : 'Drawing: OFF for others';
    this.drawEnabledButton.classList.toggle('is-active', this.drawEnabled);
  }

  destroy(): void {
    this.root.remove();
  }
}

