import { TEAM_LABELS } from '../config/constants';
import type { PlaybookGrade } from '../networking/NetworkProtocol';
import { button, el } from './dom';

/** Shown to every player once a run finishes: how close each assigned player got to their path. */
export class PlaybookResultsPane {
  private readonly root: HTMLElement;

  constructor(
    parent: HTMLElement,
    playName: string,
    grades: readonly PlaybookGrade[],
    onClose: () => void,
  ) {
    this.root = el('div', 'settings-pane playbook-results');

    const list = el('div', 'playbook-list');
    const sorted = [...grades].sort((a, b) => b.accuracyPct - a.accuracyPct);
    for (const grade of sorted) {
      const row = el('div', 'playbook-row');
      row.append(
        el('span', 'playbook-row-name', `Team ${TEAM_LABELS[grade.team]} — #${grade.number}`),
        el('span', 'playbook-row-score', grade.graded ? `${Math.round(grade.accuracyPct)}%` : '—'),
      );
      list.append(row);
    }
    if (sorted.length === 0) list.append(el('p', 'subtitle', 'Nobody was assigned a path.'));

    this.root.append(
      el('h2', 'share-title', `RESULTS: ${playName.toUpperCase()}`),
      list,
      button('Close', 'text-button', onClose),
    );

    parent.append(this.root);
  }

  destroy(): void {
    this.root.remove();
  }
}
