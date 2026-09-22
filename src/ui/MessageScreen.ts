import { button, clear, el } from './dom';

export interface MessageScreenOptions {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

export function renderMessageScreen(root: HTMLElement, options: MessageScreenOptions): void {
  clear(root);

  const panel = el('div', 'panel');
  panel.append(el('h1', 'title', options.title), el('p', 'subtitle', options.body));

  if (options.actionLabel && options.onAction) {
    panel.append(button(options.actionLabel, 'primary-button', options.onAction));
  }
  if (options.secondaryLabel && options.onSecondary) {
    panel.append(button(options.secondaryLabel, 'secondary-button', options.onSecondary));
  }

  root.append(panel);
}
