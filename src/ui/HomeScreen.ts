import { MAX_PLAYERS } from '../config/constants';
import { button, clear, el } from './dom';

export interface HomeScreenHandlers {
  onCreateGame: () => void;
}

export function renderHomeScreen(root: HTMLElement, handlers: HomeScreenHandlers): void {
  clear(root);

  const panel = el('div', 'panel');
  panel.append(
    el('h1', 'title', 'POCKET ARENA'),
    el('p', 'subtitle', `2-${MAX_PLAYERS} PLAYER BROWSER GAME`),
    button('CREATE GAME', 'primary-button', handlers.onCreateGame),
  );

  root.append(panel);
}
