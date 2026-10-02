import { el } from './dom';

const STEPS = [
  'Add players to each team with "+ Add Player" — pick any mix, e.g. 6 vs 6 or 2 vs 0.',
  'Tap a player chip to select them — their name highlights while armed.',
  'Tap the field once to set their Start position, then tap again to set their End position.',
  'Set the step Start Time. Duration is calculated from the travel distance and cannot be shorter than the game allows; increase it to make the player move more slowly, then press "Add Step".',
  'Repeat for more movements, or arm another player to build out the whole play.',
  'Press Preview to watch it animate, Export Video to save a clip, or Save Play when done.',
];

/** A one-time how-to shown from the editor's "?" button. Purely informational, no handlers. */
export class PlaybookInstructions {
  private readonly root: HTMLElement;

  constructor(parent: HTMLElement, onClose: () => void) {
    this.root = el('div', 'settings-pane playbook-instructions');

    const list = el('ol', 'playbook-instructions-list');
    for (const step of STEPS) {
      list.append(el('li', 'playbook-instructions-item', step));
    }

    const closeButton = el('button', 'primary-button', 'Got it');
    closeButton.type = 'button';
    closeButton.addEventListener('click', onClose);

    this.root.append(el('h2', 'share-title', 'HOW TO BUILD A PLAY'), list, closeButton);
    parent.append(this.root);
  }

  destroy(): void {
    this.root.remove();
  }
}
