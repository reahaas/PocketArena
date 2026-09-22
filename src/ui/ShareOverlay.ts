import { MAX_PLAYERS } from '../config/constants';
import { buildShareMessage } from '../room/InviteLink';
import { button, el } from './dom';

/**
 * Sits on top of the live game rather than acting as a lobby — the host is already playing
 * while this is open (decision A1).
 */
export class ShareOverlay {
  private readonly root: HTMLElement;
  private readonly counter: HTMLElement;
  private readonly status: HTMLElement;

  constructor(parent: HTMLElement, private readonly inviteUrl: string) {
    this.root = el('div', 'share-overlay');

    const linkPreview = el('p', 'share-link', this.inviteUrl);
    this.counter = el('p', 'share-count', `Players: 1 / ${MAX_PLAYERS}`);
    this.status = el('p', 'share-status', '');

    const actions = el('div', 'share-actions');
    actions.append(
      button('SHARE GAME', 'primary-button', () => void this.share()),
      button('COPY LINK', 'secondary-button', () => void this.copy()),
    );

    this.root.append(
      el('h2', 'share-title', 'GAME CREATED'),
      el('p', 'subtitle', 'Invite your friends'),
      linkPreview,
      actions,
      this.counter,
      this.status,
      button('Dismiss', 'text-button', () => this.hide()),
    );

    parent.append(this.root);
  }

  setPlayerCount(count: number): void {
    this.counter.textContent = `Players: ${count} / ${MAX_PLAYERS}`;
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  destroy(): void {
    this.root.remove();
  }

  private async share(): Promise<void> {
    const payload = buildShareMessage(this.inviteUrl);

    if (navigator.share) {
      try {
        await navigator.share(payload);
        return;
      } catch {
        // The user dismissed the sheet, or the platform refused. Fall back to copying.
      }
    }
    await this.copy();
  }

  private async copy(): Promise<void> {
    const ok = await copyToClipboard(this.inviteUrl);
    this.status.textContent = ok ? 'Link copied' : 'Copy failed — select the link above';
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Clipboard API needs a secure context and a user gesture; fall through.
    }
  }

  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.append(field);
  field.select();

  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
}
