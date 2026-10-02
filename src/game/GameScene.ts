import Phaser from 'phaser';

import { DEFAULT_SPORT } from '../config/constants';
import type { SportType, TeamId } from '../config/constants';
import type { DrawArrow, PlaybookAssignment, Play } from '../networking/NetworkProtocol';
import { Arena } from './Arena';
import { DrawLayer } from './DrawLayer';
import { PlayerManager } from './PlayerManager';
import type { ArmedTarget } from './PlaybookLayer';
import { PlaybookLayer } from './PlaybookLayer';
import type { RenderPlayer } from './RenderPlayer';

export interface SceneBridge {
  renderPlayers(nowMs: number): RenderPlayer[];
}

export class GameScene extends Phaser.Scene {
  private players!: PlayerManager;
  private arena: Arena | null = null;
  private drawLayer: DrawLayer | null = null;
  private playbookLayer: PlaybookLayer | null = null;
  private bridge: SceneBridge | null = null;
  private pendingSport: SportType = DEFAULT_SPORT;
  private pendingRoster: readonly { playerId: string; team: TeamId; number: number }[] = [];
  private pendingArrows: readonly DrawArrow[] = [];
  private pendingDrawMode = false;
  private onArrowDrawnCallback: ((x1: number, y1: number, x2: number, y2: number) => void) | null =
    null;
  private pendingPlaybookEdit: {
    enabled: boolean;
    armed: ArmedTarget | null;
    onFieldTap: (x: number, y: number) => void;
  } | null = null;
  private pendingPlaybookAssignments: readonly PlaybookAssignment[] = [];
  private pendingPlaybookEditPlayers: readonly ArmedTarget[] = [];
  private pendingPlaybookPending: {
    start: { x: number; y: number } | null;
    end: { x: number; y: number } | null;
  } | null = null;
  private pendingPlaybookLive: {
    play: Play | null;
    localTeam: TeamId | null;
    localNumber: number | null;
    showOtherGhosts: boolean;
  } | null = null;
  private pendingPlaybookStart: number | null = null;
  private pendingPlaybookPreview: { play: Play | null; startAtLocalMs: number | null } | null = null;

  constructor() {
    super({ key: 'GameScene' });
  }

  setBridge(bridge: SceneBridge): void {
    this.bridge = bridge;
  }

  /** Safe to call before the scene finishes booting; applied immediately once it has. */
  setSport(sport: SportType): void {
    this.pendingSport = sport;
    this.arena?.setSport(sport);
  }

  /** Team/jersey info, pushed separately from — and far less often than — player positions. */
  setRoster(entries: readonly { playerId: string; team: TeamId; number: number }[]): void {
    this.pendingRoster = entries;
    this.players?.setRoster(entries);
  }

  setArrows(arrows: readonly DrawArrow[]): void {
    this.pendingArrows = arrows;
    this.drawLayer?.setArrows(arrows);
  }

  setDrawMode(enabled: boolean, onArrowDrawn: (x1: number, y1: number, x2: number, y2: number) => void): void {
    this.pendingDrawMode = enabled;
    this.onArrowDrawnCallback = onArrowDrawn;
    this.drawLayer?.setDrawMode(enabled, onArrowDrawn);
  }

  /** Host-only: armed === null disables tap-to-place without leaving the editor. */
  setPlaybookEditMode(
    enabled: boolean,
    armed: ArmedTarget | null,
    onFieldTap: (x: number, y: number) => void,
  ): void {
    this.pendingPlaybookEdit = { enabled, armed, onFieldTap };
    this.playbookLayer?.setEditMode(enabled, armed, onFieldTap);
  }

  setPlaybookEditAssignments(assignments: readonly PlaybookAssignment[]): void {
    this.pendingPlaybookAssignments = assignments;
    this.playbookLayer?.setEditAssignments(assignments);
  }

  /** The coach's draft player list — shown as static markers on the field, even with no steps yet. */
  setPlaybookEditPlayers(players: readonly ArmedTarget[]): void {
    this.pendingPlaybookEditPlayers = players;
    this.playbookLayer?.setEditPlayers(players);
  }

  /** The start/end points placed so far for the step the coach is currently building. */
  setPlaybookPendingPoints(
    start: { x: number; y: number } | null,
    end: { x: number; y: number } | null,
  ): void {
    this.pendingPlaybookPending = { start, end };
    this.playbookLayer?.setPendingPoints(start, end);
  }

  setPlaybookLiveView(
    play: Play | null,
    localTeam: TeamId | null,
    localNumber: number | null,
    showOtherGhosts = false,
  ): void {
    this.pendingPlaybookLive = { play, localTeam, localNumber, showOtherGhosts };
    this.playbookLayer?.setLiveView(play, localTeam, localNumber, showOtherGhosts);
  }

  setPlaybookLiveStart(startAtLocalMs: number | null): void {
    this.pendingPlaybookStart = startAtLocalMs;
    this.playbookLayer?.setLiveStart(startAtLocalMs);
  }

  /** Coach-only: animates every assignment's ghost together, independent of any live session. */
  setPlaybookPreview(play: Play | null, startAtLocalMs: number | null): void {
    this.pendingPlaybookPreview = { play, startAtLocalMs };
    this.playbookLayer?.setPreview(play, startAtLocalMs);
  }

  create(): void {
    this.arena = new Arena(this);
    this.arena.setSport(this.pendingSport);
    this.players = new PlayerManager(this);
    this.players.setRoster(this.pendingRoster);
    this.drawLayer = new DrawLayer(this);
    this.drawLayer.setArrows(this.pendingArrows);
    if (this.onArrowDrawnCallback) this.drawLayer.setDrawMode(this.pendingDrawMode, this.onArrowDrawnCallback);
    this.playbookLayer = new PlaybookLayer(this);
    if (this.pendingPlaybookEdit) {
      this.playbookLayer.setEditMode(
        this.pendingPlaybookEdit.enabled,
        this.pendingPlaybookEdit.armed,
        this.pendingPlaybookEdit.onFieldTap,
      );
    }
    this.playbookLayer.setEditAssignments(this.pendingPlaybookAssignments);
    this.playbookLayer.setEditPlayers(this.pendingPlaybookEditPlayers);
    if (this.pendingPlaybookPending) {
      this.playbookLayer.setPendingPoints(
        this.pendingPlaybookPending.start,
        this.pendingPlaybookPending.end,
      );
    }
    if (this.pendingPlaybookLive) {
      this.playbookLayer.setLiveView(
        this.pendingPlaybookLive.play,
        this.pendingPlaybookLive.localTeam,
        this.pendingPlaybookLive.localNumber,
        this.pendingPlaybookLive.showOtherGhosts,
      );
    }
    this.playbookLayer.setLiveStart(this.pendingPlaybookStart);
    if (this.pendingPlaybookPreview) {
      this.playbookLayer.setPreview(
        this.pendingPlaybookPreview.play,
        this.pendingPlaybookPreview.startAtLocalMs,
      );
    }
    this.cameras.main.setBackgroundColor('#020617');
  }

  // Rendering only. The authoritative simulation runs on its own clock in GameLoop.
  override update(): void {
    if (!this.bridge) return;

    // performance.now() keeps render sampling on the same clock as the networking layer.
    // The camera never moves: the board is scaled to fit, so everyone is always visible.
    const now = performance.now();
    this.players.sync(this.bridge.renderPlayers(now));
    this.playbookLayer?.update(now);
  }
}
