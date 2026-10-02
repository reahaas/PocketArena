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
  private readonly parent: HTMLElement;
  private lastViewport = { width: 0, height: 0 };
  private bottomInsetPx = 0;

  constructor(parent: HTMLElement, bridge: SceneBridge, initialSport: SportType = DEFAULT_SPORT) {
    this.parent = parent;
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
      this.lastViewport = { width, height };
      this.applyViewportSize();
    });
  }

  private applyViewportSize(): void {
    const { width, height } = this.lastViewport;
    if (width <= 0 || height <= 0) return;
    // Reserving space at the bottom (e.g. for the docked playbook editor) shrinks the board
    // instead of letting a panel cover it — the whole field stays visible and operable.
    const usableHeight = Math.max(1, height - this.bottomInsetPx);
    this.parent.style.width = `${width}px`;
    this.parent.style.height = `${usableHeight}px`;
    this.game.scale.setParentSize(width, usableHeight);
    this.game.scale.refresh();
  }

  /** Reserves viewport height at the bottom of the field so a docked panel never overlaps it. */
  setBottomInset(px: number): void {
    this.bottomInsetPx = Math.max(0, px);
    this.applyViewportSize();
  }

  /** The live Phaser canvas — used to record a playbook preview to a shareable video file. */
  get canvasElement(): HTMLCanvasElement {
    return this.game.canvas;
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

  /** Host-only: arms a player for tap-to-place step editing in the playbook editor. */
  setPlaybookEditMode(
    enabled: boolean,
    armed: ArmedTarget | null,
    onFieldTap: (x: number, y: number) => void,
  ): void {
    this.scene.setPlaybookEditMode(enabled, armed, onFieldTap);
  }

  /** The full draft roster being edited, redrawn whenever any assignment's steps change. */
  setPlaybookEditAssignments(assignments: readonly PlaybookAssignment[]): void {
    this.scene.setPlaybookEditAssignments(assignments);
  }

  /** The coach's draft player list — shown as static markers on the field, even with no steps yet. */
  setPlaybookEditPlayers(players: readonly ArmedTarget[]): void {
    this.scene.setPlaybookEditPlayers(players);
  }

  /** The start/end points placed so far for the step the coach is currently building. */
  setPlaybookPendingPoints(
    start: { x: number; y: number } | null,
    end: { x: number; y: number } | null,
  ): void {
    this.scene.setPlaybookPendingPoints(start, end);
  }

  /** Shows (or, with `play: null`, hides) a launched play's paths for every connected player. */
  setPlaybookLiveView(
    play: Play | null,
    localTeam: TeamId | null,
    localNumber: number | null,
    showOtherGhosts = false,
  ): void {
    this.scene.setPlaybookLiveView(play, localTeam, localNumber, showOtherGhosts);
  }

  /** Local-clock time grading begins; `null` while only the path (not the ghost target) shows. */
  setPlaybookLiveStart(startAtLocalMs: number | null): void {
    this.scene.setPlaybookLiveStart(startAtLocalMs);
  }

  /** Coach-only: plays every assignment's ghost together, with no live session required. */
  setPlaybookPreview(play: Play | null, startAtLocalMs: number | null): void {
    this.scene.setPlaybookPreview(play, startAtLocalMs);
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
