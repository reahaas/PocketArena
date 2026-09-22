import Phaser from 'phaser';

import { ARENA_HEIGHT, ARENA_WIDTH, DEFAULT_SPORT } from '../config/constants';
import type { SportType } from '../config/constants';
import { watchViewport } from '../utils/viewport';
import { GameScene, type SceneBridge } from './GameScene';

export class Game {
  private readonly game: Phaser.Game;
  private readonly scene = new GameScene();
  private readonly stopWatchingViewport: () => void;

  constructor(parent: HTMLElement, bridge: SceneBridge, initialSport: SportType = DEFAULT_SPORT) {
    this.scene.setBridge(bridge);
    this.scene.setSport(initialSport);

    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      backgroundColor: '#020617',
      scale: {
        // FIT scales the whole board to the viewport, so every player is always on screen
        // and the world never scrolls out from under the camera.
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: ARENA_WIDTH,
        height: ARENA_HEIGHT,
        // We size the parent ourselves; letting Phaser also manage it causes stale bounds
        // after an orientation change.
        expandParent: false,
      },
      scene: [this.scene],
      banner: false,
      audio: { noAudio: true },
    });

    // Phaser measures its parent to decide the fit, and on a phone that box can still hold the
    // pre-rotation size. Feeding it the visual viewport directly is what keeps the board
    // full-screen through rotation and fullscreen toggles.
    this.stopWatchingViewport = watchViewport((width, height) => {
      parent.style.width = `${width}px`;
      parent.style.height = `${height}px`;
      this.game.scale.setParentSize(width, height);
      this.game.scale.refresh();
    });
  }

  /** Exposed so end-to-end tests can assert the board never scrolls. */
  cameraScroll(): { x: number; y: number } {
    const camera = this.scene.cameras?.main;
    return { x: camera?.scrollX ?? 0, y: camera?.scrollY ?? 0 };
  }

  /** Swaps the field/court/pool markings without rebuilding the game or losing player state. */
  setSport(sport: SportType): void {
    this.scene.setSport(sport);
  }

  get isFullscreenSupported(): boolean {
    return typeof document.documentElement.requestFullscreen === 'function';
  }

  get isFullscreen(): boolean {
    return document.fullscreenElement !== null;
  }

  /**
   * Fullscreens the whole page rather than Phaser's canvas: the joystick and overlays live in a
   * sibling element, and would be hidden if only the canvas entered fullscreen.
   */
  toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    void document.documentElement.requestFullscreen().catch(() => undefined);
  }

  destroy(): void {
    this.stopWatchingViewport();
    this.game.destroy(true);
  }
}
