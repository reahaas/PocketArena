import { MAX_PLAYBOOK_NAME_LENGTH, TEAM_COLORS } from '../config/constants';
import type { TeamId } from '../config/constants';
import { button, el } from './dom';

export interface PlaybookEditorRosterEntry {
  team: TeamId;
  number: number;
}

export interface PlaybookEditorHandlers {
  /** Fires with the chip the coach just tapped, or `null` if the previously-armed one was tapped again. */
  onArm: (target: PlaybookEditorRosterEntry | null) => void;
  onUndo: () => void;
  onClearArmed: () => void;
  onSave: (name: string) => void;
  onCancel: () => void;
}

export function teamNumberKey(team: TeamId, number: number): string {
  return `${team}:${number}`;
}

/**
 * The coach's play designer: pick a player chip, then tap the field (handled by the game layer,
 * wired outside this pane) to append waypoints to that player's path.
 */
export class PlaybookEditor {
  private readonly root: HTMLElement;
  private readonly chipRow: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly chips = new Map<string, HTMLButtonElement>();
  readonly nameInput: HTMLInputElement;

  constructor(
    parent: HTMLElement,
    roster: readonly PlaybookEditorRosterEntry[],
    handlers: PlaybookEditorHandlers,
  ) {
    this.root = el('div', 'settings-pane playbook-editor');

    this.nameInput = document.createElement('input');
    this.nameInput.type = 'text';
    this.nameInput.placeholder = 'Play name';
    this.nameInput.maxLength = MAX_PLAYBOOK_NAME_LENGTH;
    this.nameInput.className = 'playbook-name-input';

    this.chipRow = el('div', 'playbook-chip-row');
    for (const entry of roster) {
      const key = teamNumberKey(entry.team, entry.number);
      const chip = button(String(entry.number), 'playbook-chip', () => {
        const wasArmed = chip.classList.contains('is-active');
        handlers.onArm(wasArmed ? null : entry);
      });
      chip.style.borderColor = `#${TEAM_COLORS[entry.team].toString(16).padStart(6, '0')}`;
      this.chips.set(key, chip);
      this.chipRow.append(chip);
    }

    this.summary = el('p', 'subtitle', 'Tap a player, then tap the field to place their path.');

    const toolRow = el('div', 'settings-options');
    toolRow.append(
      button('Undo Last Point', 'secondary-button', handlers.onUndo),
      button('Clear This Path', 'secondary-button', handlers.onClearArmed),
    );

    this.root.append(
      el('h2', 'share-title', 'NEW PLAY'),
      this.nameInput,
      this.chipRow,
      this.summary,
      toolRow,
      button('Save Play', 'primary-button', () => handlers.onSave(this.nameInput.value.trim())),
      button('Cancel', 'text-button', handlers.onCancel),
    );

    parent.append(this.root);
  }

  setArmed(target: PlaybookEditorRosterEntry | null): void {
    const armedKey = target ? teamNumberKey(target.team, target.number) : null;
    for (const [key, chip] of this.chips) chip.classList.toggle('is-active', key === armedKey);
  }

  setSummary(text: string): void {
    this.summary.textContent = text;
  }

  destroy(): void {
    this.root.remove();
  }
}
