import Phaser from 'phaser';

import { DEFAULT_SPORT } from '../config/constants';
import type { SportType, TeamId } from '../config/constants';
import type { DrawArrow } from '../networking/NetworkProtocol';
import { Arena } from './Arena';
import { DrawLayer } from './DrawLayer';
import { PlayerManager } from './PlayerManager';
import type { RenderPlayer } from './RenderPlayer';

export interface SceneBridge {
  renderPlayers(nowMs: number): RenderPlayer[];
}

export class GameScene extends Phaser.Scene {
  private players!: PlayerManager;
  private arena: Arena | null = null;
  private drawLayer: DrawLayer | null = null;
  private bridge: SceneBridge | null = null;
  private pendingSport: SportType = DEFAULT_SPORT;
  private pendingRoster: readonly { playerId: string; team: TeamId; number: number }[] = [];
  private pendingArrows: readonly DrawArrow[] = [];
  private pendingDrawMode = false;
  private onArrowDrawnCallback: ((x1: number, y1: number, x2: number, y2: number) => void) | null =
    null;

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

  create(): void {
    this.arena = new Arena(this);
    this.arena.setSport(this.pendingSport);
    this.players = new PlayerManager(this);
    this.players.setRoster(this.pendingRoster);
    this.drawLayer = new DrawLayer(this);
    this.drawLayer.setArrows(this.pendingArrows);
    if (this.onArrowDrawnCallback) this.drawLayer.setDrawMode(this.pendingDrawMode, this.onArrowDrawnCallback);
    this.cameras.main.setBackgroundColor('#020617');
  }

  // Rendering only. The authoritative simulation runs on its own clock in GameLoop.
  override update(): void {
    if (!this.bridge) return;

    // performance.now() keeps render sampling on the same clock as the networking layer.
    // The camera never moves: the board is scaled to fit, so everyone is always visible.
    this.players.sync(this.bridge.renderPlayers(performance.now()));
  }
}

