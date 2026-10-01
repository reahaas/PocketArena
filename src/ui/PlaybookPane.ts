import type { Play } from '../networking/NetworkProtocol';
import { button, clear, el } from './dom';

export interface PlaybookPaneHandlers {
  /** Omitted in the offline studio's "run saved plays" view — hides the "+ New Play" button. */
  onNew?: () => void;
  /** Omitted in the offline studio — hides "Run" on every row, since there's no room to run against. */
  onRun?: (play: Play) => void;
  onExport: (play: Play) => void;
  onImport: (file: File) => void;
  onDelete: (play: Play) => void;
  onClose: () => void;
}

/** The saved-plays library, plus the tools to create, launch, or share one (whichever apply). */
export class PlaybookPane {
  private readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private readonly handlers: PlaybookPaneHandlers;

  constructor(parent: HTMLElement, plays: readonly Play[], handlers: PlaybookPaneHandlers) {
    this.handlers = handlers;
    this.root = el('div', 'settings-pane playbook-pane');
    this.list = el('div', 'playbook-list');

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'application/json';
    this.fileInput.className = 'playbook-file-input';
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      if (file) handlers.onImport(file);
      this.fileInput.value = '';
    });

    const actions = el('div', 'settings-options');
    if (handlers.onNew) actions.append(button('+ New Play', 'secondary-button', handlers.onNew));
    actions.append(button('Import File', 'secondary-button', () => this.fileInput.click()));

    this.root.append(
      el('h2', 'share-title', 'PLAYBOOK'),
      actions,
      this.list,
      this.fileInput,
      button('Close', 'text-button', handlers.onClose),
    );

    this.update(plays);
    parent.append(this.root);
  }

  update(plays: readonly Play[]): void {
    clear(this.list);
    if (plays.length === 0) {
      this.list.append(el('p', 'subtitle', 'No saved plays yet.'));
      return;
    }

    for (const play of plays) {
      const row = el('div', 'playbook-row');
      row.append(
        el(
          'span',
          'playbook-row-name',
          `${play.name} — ${play.assignments.length} player${play.assignments.length === 1 ? '' : 's'}`,
        ),
      );
      const rowActions = el('div', 'playbook-row-actions');
      if (this.handlers.onRun) {
        const onRun = this.handlers.onRun;
        rowActions.append(button('Run', 'primary-button', () => onRun(play)));
      }
      rowActions.append(
        button('Export', 'text-button', () => this.handlers.onExport(play)),
        button('Delete', 'text-button', () => this.handlers.onDelete(play)),
      );
      row.append(rowActions);
      this.list.append(row);
    }
  }

  destroy(): void {
    this.root.remove();
  }
}
