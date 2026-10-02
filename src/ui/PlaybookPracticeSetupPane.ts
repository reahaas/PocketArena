import { TEAM_LABELS } from '../config/constants';
import type { Play, PlaybookAssignment } from '../networking/NetworkProtocol';
import { button, el } from './dom';

export interface PlaybookPracticeSetupHandlers {
  onStart: (assignment: PlaybookAssignment) => void;
  onCancel: () => void;
}

/** Lets the player choose which playbook role they will control for a solo practice attempt. */
export class PlaybookPracticeSetupPane {
  private readonly root: HTMLElement;
  private readonly playerSelect: HTMLSelectElement;

  constructor(
    parent: HTMLElement,
    play: Play,
    handlers: PlaybookPracticeSetupHandlers,
  ) {
    this.root = el('div', 'settings-pane playbook-practice-setup');
    this.playerSelect = document.createElement('select');
    this.playerSelect.className = 'playbook-practice-select';
    this.playerSelect.setAttribute('aria-label', 'Choose the player you want to control');

    const assignments = play.assignments.filter((assignment) => assignment.steps.length > 0);
    for (const assignment of assignments) {
      const option = document.createElement('option');
      option.value = `${assignment.team}:${assignment.number}`;
      option.textContent = `Team ${TEAM_LABELS[assignment.team]} — #${assignment.number}`;
      this.playerSelect.append(option);
    }

    const actions = el('div', 'playbook-editor-footer');
    actions.append(
      button('Start Practice', 'primary-button', () => {
        const selected = assignments.find(
          (assignment) =>
            `${assignment.team}:${assignment.number}` === this.playerSelect.value,
        );
        if (selected) handlers.onStart(selected);
      }),
      button('Back', 'text-button', handlers.onCancel),
    );

    this.root.append(
      el('h2', 'share-title', `PRACTICE: ${play.name.toUpperCase()}`),
      el(
        'p',
        'subtitle',
        'Choose the player you want to control. The other assigned players will follow their paths as ghosts.',
      ),
      el('p', 'subtitle', 'Move with the joystick or WASD/arrow keys; try to reach each target at the planned time.'),
      this.playerSelect,
      actions,
    );
    parent.append(this.root);
  }

  destroy(): void {
    this.root.remove();
  }
}
