import {
  MAX_PLAYBOOK_NAME_LENGTH,
  MAX_PLAYBOOK_PLAYERS_PER_TEAM,
  TEAMS,
  TEAM_COLORS,
  TEAM_LABELS,
} from '../config/constants';
import type { TeamId } from '../config/constants';
import { button, clear, el } from './dom';

export interface PlaybookEditorPlayer {
  team: TeamId;
  number: number;
}

export type PlaybookStepStage = 'start' | 'end';

export interface PlaybookEditorHandlers {
  onAddPlayer: (team: TeamId) => void;
  onRemovePlayer: (player: PlaybookEditorPlayer) => void;
  /** Fires with the chip the coach just tapped, or `null` if the previously-armed one was tapped again. */
  onArm: (target: PlaybookEditorPlayer | null) => void;
  onSetStage: (stage: PlaybookStepStage) => void;
  onAddStep: (startSeconds: number, durationSeconds: number) => void;
  onUndoStep: () => void;
  onClearPath: () => void;
  /** Fires on every keystroke in the name field — used to keep the autosaved draft's name fresh. */
  onNameChange: (name: string) => void;
  onSave: (name: string) => void;
  onPreview: () => void;
  onExportVideo: () => void;
  onHelp: () => void;
  onCancel: () => void;
  /** The bar's rendered height, so the caller can shrink the field to make room for it. */
  onHeightChange: (heightPx: number) => void;
}

export function teamNumberKey(team: TeamId, number: number): string {
  return `${team}:${number}`;
}

/**
 * The coach's play designer. Docked along the bottom of the screen — rather than a centered
 * modal — so the whole field stays visible and tappable while building a play. The roster here
 * is independent of who is actually connected: the coach can add or remove players per team to
 * design a play for any squad size (6v6, 2v0, etc.) ahead of time.
 */
export class PlaybookEditor {
  private readonly root: HTMLElement;
  private readonly teamRows: Record<TeamId, HTMLElement>;
  private readonly chips = new Map<string, HTMLButtonElement>();
  private readonly stepBuilder: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly startButton: HTMLButtonElement;
  private readonly endButton: HTMLButtonElement;
  private readonly startReadout: HTMLElement;
  private readonly endReadout: HTMLElement;
  private readonly startTimeInput: HTMLInputElement;
  private readonly durationInput: HTMLInputElement;
  private readonly addStepButton: HTMLButtonElement;
  private readonly statusText: HTMLElement;
  private readonly autosaveNote: HTMLElement;
  private readonly resizeObserver: ResizeObserver | null;
  readonly nameInput: HTMLInputElement;

  constructor(parent: HTMLElement, handlers: PlaybookEditorHandlers) {
    this.root = el('div', 'playbook-editor-bar');

    this.nameInput = document.createElement('input');
    this.nameInput.type = 'text';
    this.nameInput.placeholder = 'Play name';
    this.nameInput.maxLength = MAX_PLAYBOOK_NAME_LENGTH;
    this.nameInput.className = 'playbook-name-input';
    this.nameInput.addEventListener('input', () => handlers.onNameChange(this.nameInput.value));

    this.autosaveNote = el('p', 'playbook-autosave-note', '');

    const helpButton = button('?', 'playbook-help-button', handlers.onHelp);
    const header = el('div', 'playbook-editor-header');
    header.append(this.nameInput, helpButton);

    this.teamRows = { A: el('div', 'playbook-team-row'), B: el('div', 'playbook-team-row') };
    const teamsSection = el('div', 'playbook-teams');
    for (const team of TEAMS) {
      const section = el('div', 'playbook-team-section');
      const label = el('span', 'playbook-team-label', `TEAM ${TEAM_LABELS[team]}`);
      label.style.color = `#${TEAM_COLORS[team].toString(16).padStart(6, '0')}`;
      const addButton = button('+ Add Player', 'text-button', () => handlers.onAddPlayer(team));
      section.append(label, this.teamRows[team], addButton);
      teamsSection.append(section);
    }

    this.startReadout = el('span', 'playbook-point-readout', 'Start: not set');
    this.endReadout = el('span', 'playbook-point-readout', 'End: not set');
    this.startButton = button('① Tap field for Start', 'secondary-button', () => handlers.onSetStage('start'));
    this.endButton = button('② Tap field for End', 'secondary-button', () => handlers.onSetStage('end'));

    this.startTimeInput = document.createElement('input');
    this.startTimeInput.type = 'number';
    this.startTimeInput.min = '0';
    this.startTimeInput.step = '0.1';
    this.startTimeInput.className = 'playbook-time-input';
    const startTimeField = el('label', 'playbook-field-label', 'Start (s)');
    startTimeField.append(this.startTimeInput);

    this.durationInput = document.createElement('input');
    this.durationInput.type = 'number';
    this.durationInput.min = '0.1';
    this.durationInput.step = '0.1';
    this.durationInput.className = 'playbook-time-input';
    const durationField = el('label', 'playbook-field-label', 'Duration (s)');
    durationField.append(this.durationInput);

    this.addStepButton = button('+ Add Step', 'primary-button', () =>
      handlers.onAddStep(
        Number.parseFloat(this.startTimeInput.value) || 0,
        Number.parseFloat(this.durationInput.value) || 0,
      ),
    );

    this.summary = el('p', 'subtitle playbook-summary', 'Add a player, then arm them to start placing steps.');

    this.stepBuilder = el('div', 'playbook-step-builder');
    const pointRow = el('div', 'playbook-point-row');
    pointRow.append(this.startButton, this.startReadout, this.endButton, this.endReadout);
    const timeRow = el('div', 'playbook-time-row');
    timeRow.append(startTimeField, durationField, this.addStepButton);
    const toolRow = el('div', 'playbook-tool-row');
    toolRow.append(
      button('Undo Last Step', 'text-button', handlers.onUndoStep),
      button('Clear Path', 'text-button', handlers.onClearPath),
    );
    this.stepBuilder.append(pointRow, timeRow, toolRow);
    this.stepBuilder.classList.add('is-hidden');

    this.statusText = el('p', 'playbook-status', '');

    const footer = el('div', 'playbook-editor-footer');
    footer.append(
      button('Preview', 'secondary-button', handlers.onPreview),
      button('Export Video', 'secondary-button', handlers.onExportVideo),
      button('Save Play', 'primary-button', () => handlers.onSave(this.nameInput.value.trim())),
      button('Cancel', 'text-button', handlers.onCancel),
    );

    this.root.append(header, this.autosaveNote, teamsSection, this.summary, this.stepBuilder, this.statusText, footer);
    parent.append(this.root);

    this.resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => handlers.onHeightChange(this.root.getBoundingClientRect().height))
        : null;
    this.resizeObserver?.observe(this.root);
    // ResizeObserver's first callback can lag a frame behind mount; report the initial size too.
    handlers.onHeightChange(this.root.getBoundingClientRect().height);
  }

  /** Rebuilds the per-team chip rows from scratch — simplest way to stay in sync with the draft roster. */
  setPlayers(
    players: readonly PlaybookEditorPlayer[],
    armed: PlaybookEditorPlayer | null,
    onArm: PlaybookEditorHandlers['onArm'],
    onRemove: PlaybookEditorHandlers['onRemovePlayer'],
  ): void {
    this.chips.clear();
    for (const team of TEAMS) {
      clear(this.teamRows[team]);
      const teamPlayers = players.filter((p) => p.team === team);
      for (const player of teamPlayers) {
        const key = teamNumberKey(player.team, player.number);
        const chip = el('div', 'playbook-chip-wrap');
        const chipButton = button(String(player.number), 'playbook-chip', () => {
          const wasArmed = chipButton.classList.contains('is-active');
          onArm(wasArmed ? null : player);
        });
        chipButton.style.borderColor = `#${TEAM_COLORS[player.team].toString(16).padStart(6, '0')}`;
        const removeButton = button('×', 'playbook-chip-remove', () => onRemove(player));
        chip.append(chipButton, removeButton);
        this.teamRows[team].append(chip);
        this.chips.set(key, chipButton);
      }
      this.teamRows[team].classList.toggle('is-full', teamPlayers.length >= MAX_PLAYBOOK_PLAYERS_PER_TEAM);
    }
    this.setArmed(armed);
  }

  setArmed(target: PlaybookEditorPlayer | null): void {
    const armedKey = target ? teamNumberKey(target.team, target.number) : null;
    for (const [key, chip] of this.chips) chip.classList.toggle('is-active', key === armedKey);
    this.stepBuilder.classList.toggle('is-hidden', target === null);
  }

  setStage(stage: PlaybookStepStage): void {
    this.startButton.classList.toggle('is-active', stage === 'start');
    this.endButton.classList.toggle('is-active', stage === 'end');
  }

  setPendingReadout(start: { x: number; y: number } | null, end: { x: number; y: number } | null): void {
    this.startReadout.textContent = start
      ? `Start: ${Math.round(start.x)}, ${Math.round(start.y)}`
      : 'Start: not set';
    this.endReadout.textContent = end ? `End: ${Math.round(end.x)}, ${Math.round(end.y)}` : 'End: not set';
  }

  setTimingDefaults(startSeconds: number, durationSeconds: number): void {
    this.startTimeInput.value = startSeconds.toFixed(1);
    this.durationInput.value = durationSeconds.toFixed(1);
  }

  setCanAddStep(enabled: boolean): void {
    this.addStepButton.toggleAttribute('disabled', !enabled);
  }

  setSummary(text: string): void {
    this.summary.textContent = text;
  }

  setStatus(text: string): void {
    this.statusText.textContent = text;
  }

  setAutosaveNote(text: string): void {
    this.autosaveNote.textContent = text;
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.root.remove();
  }
}
