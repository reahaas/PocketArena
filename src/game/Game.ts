import Phaser from 'phaser';

import { ARENA_HEIGHT, ARENA_WIDTH, DEFAULT_SPORT } from '../config/constants';
import type { SportType, TeamId } from '../config/constants';
import type { DrawArrow, PlaybookAssignment, Play } from '../networking/NetworkProtocol';
import { watchViewport } from '../utils/viewport';
import { GameScene, type SceneBridge } from './GameScene';
import type { ArmedTarget } from './PlaybookLayer';

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

  /** Team colours and jersey numbers, kept separate from the high-rate physics snapshots. */
  setRoster(entries: readonly { playerId: string; team: TeamId; number: number }[]): void {
    this.scene.setRoster(entries);
  }

  setArrows(arrows: readonly DrawArrow[]): void {
    this.scene.setArrows(arrows);
  }

  /** Toggles this device's own tactics-board drawing. `onArrowDrawn` gets world coordinates. */
  setDrawMode(enabled: boolean, onArrowDrawn: (x1: number, y1: number, x2: number, y2: number) => void): void {
    this.scene.setDrawMode(enabled, onArrowDrawn);
  }

  /** Host-only: arms a player for tap-to-place waypoint editing in the playbook editor. */
  setPlaybookEditMode(
    enabled: boolean,
    armed: ArmedTarget | null,
    onWaypointPlaced: (x: number, y: number) => void,
  ): void {
    this.scene.setPlaybookEditMode(enabled, armed, onWaypointPlaced);
  }

  /** The full draft roster being edited, redrawn whenever any assignment's path changes. */
  setPlaybookEditAssignments(assignments: readonly PlaybookAssignment[]): void {
    this.scene.setPlaybookEditAssignments(assignments);
  }

  /** Shows (or, with `play: null`, hides) a launched play's paths for every connected player. */
  setPlaybookLiveView(play: Play | null, localTeam: TeamId | null, localNumber: number | null): void {
    this.scene.setPlaybookLiveView(play, localTeam, localNumber);
  }

  /** Local-clock time grading begins; `null` while only the path (not the ghost target) shows. */
  setPlaybookLiveStart(startAtLocalMs: number | null): void {
    this.scene.setPlaybookLiveStart(startAtLocalMs);
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

