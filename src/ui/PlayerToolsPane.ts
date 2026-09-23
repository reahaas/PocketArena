import { TEAM_LABELS } from '../config/constants';
import type { TeamId } from '../config/constants';
import { button, el } from './dom';

export interface PlayerToolsPaneOptions {
  team: TeamId;
  number: number;
  /** True for the host (always) or a client the host has opened the board to. */
  canDraw: boolean;
  inDrawMode: boolean;
  onChangeNumber: () => void;
  onToggleDrawMode: () => void;
  onClearMine: () => void;
  onClose: () => void;
}

/** Every player's own controls: pick a jersey number, and — if allowed — draw on the board. */
export class PlayerToolsPane {
  private readonly root: HTMLElement;
  private readonly drawToggleButton: HTMLButtonElement | null = null;

  constructor(parent: HTMLElement, options: PlayerToolsPaneOptions) {
    this.root = el('div', 'settings-pane');

    const summary = el(
      'p',
      'subtitle',
      `Team ${TEAM_LABELS[options.team]} — #${options.number}`,
    );

    const items = el('div', 'settings-options');
    items.append(button('Change Number', 'secondary-button', options.onChangeNumber));

    if (options.canDraw) {
      this.drawToggleButton = button(
        options.inDrawMode ? 'Exit Draw Mode' : 'Enter Draw Mode',
        'secondary-button',
        options.onToggleDrawMode,
      );
      items.append(
        this.drawToggleButton,
        button('Clear My Drawings', 'secondary-button', options.onClearMine),
      );
    }

    this.root.append(
      el('h2', 'share-title', 'PLAYER TOOLS'),
      summary,
      items,
      button('Close', 'text-button', () => options.onClose()),
    );

    parent.append(this.root);
  }

  setDrawMode(inDrawMode: boolean): void {
    if (this.drawToggleButton) {
      this.drawToggleButton.textContent = inDrawMode ? 'Exit Draw Mode' : 'Enter Draw Mode';
    }
  }

  destroy(): void {
    this.root.remove();
  }
}
