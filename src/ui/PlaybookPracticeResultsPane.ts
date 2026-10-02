import { TEAM_LABELS } from '../config/constants';
import type { Play } from '../networking/NetworkProtocol';
import type { PlaybookPracticeResult } from '../game/PlaybookPractice';
import { button, el } from './dom';

export interface PlaybookPracticeResultsHandlers {
  onShare: () => void;
  onClose: () => void;
}

/** Solo attempt score breakdown and share controls. */
export class PlaybookPracticeResultsPane {
  private readonly root: HTMLElement;
  private readonly status: HTMLElement;
  private readonly shareButton: HTMLButtonElement;

  constructor(
    parent: HTMLElement,
    play: Play,
    result: PlaybookPracticeResult,
    handlers: PlaybookPracticeResultsHandlers,
  ) {
    this.root = el('div', 'settings-pane playbook-results playbook-practice-results');
    this.status = el('p', 'playbook-practice-share-status', '');
    this.shareButton = button('Share Video + Score', 'primary-button', handlers.onShare);
    const details = el('div', 'playbook-practice-score-grid');
    details.append(
      this.scoreCard('OVERALL', result.overallAccuracyPct),
      this.scoreCard('POSITION', result.positionAccuracyPct),
      this.scoreCard('TIMING', result.timingAccuracyPct),
    );

    const stepList = el('div', 'playbook-list');
    const orderedSteps = play.assignments
      .find((assignment) => assignment.team === result.team && assignment.number === result.number)
      ?.steps.slice()
      .sort((a, b) => a.startMs - b.startMs) ?? [];
    for (const [index, step] of orderedSteps.entries()) {
      const graded = result.steps[index];
      const timing =
        graded?.actualMs === null || graded?.actualMs === undefined
          ? 'Missed target'
          : `${Math.round(graded.actualMs)}ms to target (${Math.round(graded.timingAccuracyPct)}%)`;
      const row = el('div', 'playbook-row');
      row.append(
        el('span', 'playbook-row-name', `Step ${index + 1} · expected ${step.durationMs}ms`),
        el('span', 'playbook-row-score', timing),
      );
      stepList.append(row);
    }

    this.root.append(
      el('h2', 'share-title', `PRACTICE RESULTS: ${play.name.toUpperCase()}`),
      el('p', 'subtitle', `Team ${TEAM_LABELS[result.team]} — #${result.number} · Average distance ${Math.round(result.averageErrorPx)}px`),
      el(
        'p',
        'playbook-practice-share-status',
        'Position compares your movement to the planned path; timing scores when you reach each target. Overall = 70% position + 30% timing.',
      ),
      details,
      el('h3', 'playbook-practice-section-title', 'STEP TIMING'),
      stepList,
      this.status,
      this.shareButton,
      button('Back to Playbooks', 'text-button', handlers.onClose),
    );
    parent.append(this.root);
  }

  setShareStatus(text: string): void {
    this.status.textContent = text;
  }

  setSharing(sharing: boolean): void {
    this.shareButton.disabled = sharing;
    this.shareButton.textContent = sharing ? 'Preparing share...' : 'Share Video + Score';
  }

  destroy(): void {
    this.root.remove();
  }

  private scoreCard(label: string, score: number): HTMLElement {
    const card = el('div', 'playbook-practice-score-card');
    card.append(el('span', 'playbook-practice-score-label', label));
    card.append(el('strong', 'playbook-practice-score-value', `${Math.round(score)}%`));
    return card;
  }
}
