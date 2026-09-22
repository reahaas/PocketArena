import Phaser from 'phaser';

import { Arena } from './Arena';
import { PlayerManager } from './PlayerManager';
import type { RenderPlayer } from './RenderPlayer';

export interface SceneBridge {
  renderPlayers(nowMs: number): RenderPlayer[];
}

export class GameScene extends Phaser.Scene {
  private players!: PlayerManager;
  private bridge: SceneBridge | null = null;

  constructor() {
    super({ key: 'GameScene' });
  }

  setBridge(bridge: SceneBridge): void {
    this.bridge = bridge;
  }

  create(): void {
    new Arena(this);
    this.players = new PlayerManager(this);
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
