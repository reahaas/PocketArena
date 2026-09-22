import { button, clear, el } from './dom';

export interface JoinScreenHandlers {
  onJoin: () => void;
}

export function renderJoinScreen(root: HTMLElement, handlers: JoinScreenHandlers): void {
  clear(root);

  const panel = el('div', 'panel');
  panel.append(
    el('h1', 'title', 'POCKET ARENA'),
    el('p', 'subtitle', "You've been invited to a game"),
    button('JOIN GAME', 'primary-button', handlers.onJoin),
  );

  root.append(panel);
}

export function renderConnecting(root: HTMLElement, message = 'Connecting...'): void {
  clear(root);

  const panel = el('div', 'panel');
  panel.append(el('h1', 'title', 'POCKET ARENA'), el('p', 'subtitle', message));
  root.append(panel);
}
