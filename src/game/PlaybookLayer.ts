import type Phaser from 'phaser';

import { TEAM_COLORS, TEAMS } from '../config/constants';
import type { TeamId } from '../config/constants';
import type { PlaybookAssignment, Play } from '../networking/NetworkProtocol';
import { defaultPlaybookEditorPosition, expectedPlaybookPosition } from './PlaybookMath';

const OTHER_ALPHA = 0.35;
const EDIT_ALPHA = 0.6;
const MINE_ALPHA = 0.95;
const STEP_RADIUS = 9;
const GHOST_RADIUS = 16;
const PENDING_RADIUS = 14;
const PLAYER_MARKER_RADIUS = 14;

export interface ArmedTarget {
  team: TeamId;
  number: number;
}

export interface PendingPoint {
  x: number;
  y: number;
}

function assignmentKey(team: TeamId, number: number): string {
  return `${team}:${number}`;
}

/**
 * Renders every player's assigned steps (segments, numbered in order), and — only while the host
 * has a player "armed" in the editor — turns taps into start/end points for a new step. During a
 * live run it also tracks a "ghost target": where the local player should be right now, so they
 * can chase it. A separate "preview" mode plays every assignment's ghost at once, used to let the
 * coach watch (or record) the whole play without a live multiplayer session.
 */
export class PlaybookLayer {
  private readonly paths: Phaser.GameObjects.Graphics;
  private readonly ghost: Phaser.GameObjects.Graphics;
  private readonly labels: Phaser.GameObjects.Container;

  private editAssignments: readonly PlaybookAssignment[] = [];
  private editPlayers: readonly ArmedTarget[] = [];
  private editMode = false;
  private armed: ArmedTarget | null = null;
  private onFieldTap: ((x: number, y: number) => void) | null = null;
  private pendingStart: PendingPoint | null = null;
  private pendingEnd: PendingPoint | null = null;

  private livePlay: Play | null = null;
  private liveLocalKey: string | null = null;
  private liveStartAtLocalMs: number | null = null;
  private showOtherLiveGhosts = false;

  private previewPlay: Play | null = null;
  private previewStartAtLocalMs: number | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    this.paths = scene.add.graphics().setDepth(60);
    this.ghost = scene.add.graphics().setDepth(61);
    this.labels = scene.add.container(0, 0).setDepth(62);

    scene.input.on('pointerdown', this.handlePointerDown);
  }

  /** Host-only editor: while armed, tapping the field reports a point for the current step. */
  setEditMode(
    enabled: boolean,
    armed: ArmedTarget | null,
    onFieldTap: (x: number, y: number) => void,
  ): void {
    this.editMode = enabled;
    this.armed = armed;
    this.onFieldTap = onFieldTap;
    this.redrawPaths();
  }

  /** The full draft roster, redrawn whenever any assignment's steps change. */
  setEditAssignments(assignments: readonly PlaybookAssignment[]): void {
    this.editAssignments = assignments;
    this.redrawPaths();
  }

  /** The coach's draft player list — shown as static markers on the field, even with no steps yet. */
  setEditPlayers(players: readonly ArmedTarget[]): void {
    this.editPlayers = players;
    this.redrawPaths();
  }

  /** The start/end points the coach has placed for the step they're currently building. */
  setPendingPoints(start: PendingPoint | null, end: PendingPoint | null): void {
    this.pendingStart = start;
    this.pendingEnd = end;
    this.redrawPaths();
  }

  /** Set once a play is launched (countdown or running). `null` clears the overlay entirely. */
  setLiveView(
    play: Play | null,
    localTeam: TeamId | null,
    localNumber: number | null,
    showOtherGhosts = false,
  ): void {
    this.livePlay = play;
    this.liveLocalKey =
      localTeam && localNumber !== null ? assignmentKey(localTeam, localNumber) : null;
    this.showOtherLiveGhosts = Boolean(play && showOtherGhosts);
    if (!play) this.liveStartAtLocalMs = null;
    this.redrawPaths();
  }

  /** Local-clock time grading begins; `null` while still only showing the path pre-launch. */
  setLiveStart(startAtLocalMs: number | null): void {
    this.liveStartAtLocalMs = startAtLocalMs;
  }

  /** Coach-only preview: animates every assignment's ghost together, with no live session. */
  setPreview(play: Play | null, startAtLocalMs: number | null): void {
    this.previewPlay = play;
    this.previewStartAtLocalMs = startAtLocalMs;
    this.redrawPaths();
  }

  /** Call once per render frame. Advances ghost target(s) along the relevant path(s). */
  update(nowMs: number): void {
    this.ghost.clear();

    if (this.previewPlay && this.previewStartAtLocalMs !== null) {
      const elapsedMs = nowMs - this.previewStartAtLocalMs;
      if (elapsedMs < 0) return;
      for (const assignment of this.previewPlay.assignments) {
        const position = expectedPlaybookPosition(assignment.steps, elapsedMs);
        if (!position) continue;
        const color = TEAM_COLORS[assignment.team];
        this.ghost.lineStyle(3, 0xffffff, 0.9);
        this.ghost.strokeCircle(position.x, position.y, GHOST_RADIUS);
        this.ghost.fillStyle(color, 0.85);
        this.ghost.fillCircle(position.x, position.y, GHOST_RADIUS);
      }
      return;
    }

    if (!this.livePlay || this.liveStartAtLocalMs === null || !this.liveLocalKey) return;

    const mine = this.livePlay.assignments.find(
      (a) => assignmentKey(a.team, a.number) === this.liveLocalKey,
    );
    const elapsedMs = Math.max(0, nowMs - this.liveStartAtLocalMs);

    if (mine) {
      const position = expectedPlaybookPosition(mine.steps, elapsedMs);
      if (position) {
        this.ghost.lineStyle(4, 0xfacc15, 1);
        this.ghost.strokeCircle(position.x, position.y, GHOST_RADIUS);
        this.ghost.fillStyle(0xfacc15, 0.25);
        this.ghost.fillCircle(position.x, position.y, GHOST_RADIUS);
      }
    }

    if (this.showOtherLiveGhosts) {
      for (const assignment of this.livePlay.assignments) {
        if (assignmentKey(assignment.team, assignment.number) === this.liveLocalKey) continue;
        const position = expectedPlaybookPosition(assignment.steps, elapsedMs);
        if (!position) continue;
        this.ghost.lineStyle(2, 0xffffff, 0.65);
        this.ghost.strokeCircle(position.x, position.y, GHOST_RADIUS);
        this.ghost.fillStyle(TEAM_COLORS[assignment.team], 0.35);
        this.ghost.fillCircle(position.x, position.y, GHOST_RADIUS);
      }
    }
  }

  destroy(): void {
    this.scene.input.off('pointerdown', this.handlePointerDown);
    this.paths.destroy();
    this.ghost.destroy();
    this.labels.destroy();
  }

  private readonly handlePointerDown = (pointer: Phaser.Input.Pointer): void => {
    if (!this.editMode || !this.armed || !this.onFieldTap) return;
    this.onFieldTap(pointer.worldX, pointer.worldY);
  };

  private redrawPaths(): void {
    this.paths.clear();
    this.labels.removeAll(true);

    if (this.previewPlay) {
      for (const assignment of this.previewPlay.assignments) {
        this.drawAssignment(assignment, MINE_ALPHA, true);
      }
      return;
    }

    const assignments = this.livePlay ? this.livePlay.assignments : this.editAssignments;
    for (const assignment of assignments) {
      const mine = this.editMode
        ? this.armed !== null &&
          assignmentKey(this.armed.team, this.armed.number) ===
            assignmentKey(assignment.team, assignment.number)
        : this.liveLocalKey === assignmentKey(assignment.team, assignment.number);

      const alpha = this.livePlay ? (mine ? MINE_ALPHA : OTHER_ALPHA) : mine ? MINE_ALPHA : EDIT_ALPHA;
      this.drawAssignment(assignment, alpha, mine);
    }

    if (this.editMode) this.drawEditPlayerMarkers(assignments);
    this.drawPendingPoints();
  }

  /** Static "home" markers for draft players with no steps yet — otherwise they're invisible. */
  private drawEditPlayerMarkers(assignments: readonly PlaybookAssignment[]): void {
    const hasSteps = new Set(
      assignments.filter((a) => a.steps.length > 0).map((a) => assignmentKey(a.team, a.number)),
    );
    for (const team of TEAMS) {
      const teamPlayers = this.editPlayers.filter((p) => p.team === team && !hasSteps.has(assignmentKey(p.team, p.number)));
      teamPlayers.forEach((player, index) => {
        const position = defaultPlaybookEditorPosition(team, index, teamPlayers.length);
        const mine =
          this.armed !== null && assignmentKey(this.armed.team, this.armed.number) === assignmentKey(team, player.number);
        const color = TEAM_COLORS[team];

        this.paths.lineStyle(mine ? 3 : 2, 0xffffff, mine ? 0.9 : 0.5);
        this.paths.strokeCircle(position.x, position.y, PLAYER_MARKER_RADIUS);
        this.paths.fillStyle(color, mine ? MINE_ALPHA : EDIT_ALPHA);
        this.paths.fillCircle(position.x, position.y, PLAYER_MARKER_RADIUS);

        const label = this.scene.add
          .text(position.x, position.y, String(player.number), { fontSize: '13px', color: '#ffffff' })
          .setOrigin(0.5);
        this.labels.add(label);
      });
    }
  }

  private drawPendingPoints(): void {
    if (this.pendingStart) {
      this.paths.lineStyle(3, 0x22c55e, 0.9);
      this.paths.strokeCircle(this.pendingStart.x, this.pendingStart.y, PENDING_RADIUS);
      const label = this.scene.add
        .text(this.pendingStart.x, this.pendingStart.y - 28, 'START', { fontSize: '12px', color: '#22c55e' })
        .setOrigin(0.5);
      this.labels.add(label);
    }
    if (this.pendingEnd) {
      this.paths.lineStyle(3, 0xf97316, 0.9);
      this.paths.strokeCircle(this.pendingEnd.x, this.pendingEnd.y, PENDING_RADIUS);
      const label = this.scene.add
        .text(this.pendingEnd.x, this.pendingEnd.y - 28, 'END', { fontSize: '12px', color: '#f97316' })
        .setOrigin(0.5);
      this.labels.add(label);
    }
    if (this.pendingStart && this.pendingEnd) {
      this.paths.lineStyle(2, 0xffffff, 0.5);
      this.paths.lineBetween(
        this.pendingStart.x,
        this.pendingStart.y,
        this.pendingEnd.x,
        this.pendingEnd.y,
      );
    }
  }

  private drawAssignment(assignment: PlaybookAssignment, alpha: number, highlight: boolean): void {
    const color = TEAM_COLORS[assignment.team];
    const steps = [...assignment.steps].sort((a, b) => a.startMs - b.startMs);
    if (steps.length === 0) return;

    this.paths.lineStyle(highlight ? 5 : 3, color, alpha);
    steps.forEach((step, index) => {
      this.paths.lineBetween(step.fromX, step.fromY, step.toX, step.toY);

      this.paths.fillStyle(color, alpha);
      this.paths.fillCircle(step.fromX, step.fromY, STEP_RADIUS);
      if (index === steps.length - 1) {
        this.paths.fillCircle(step.toX, step.toY, STEP_RADIUS);
      }

      const text = this.scene.add
        .text(step.fromX, step.fromY - 22, String(index + 1), { fontSize: '16px', color: '#ffffff' })
        .setOrigin(0.5)
        .setAlpha(alpha);
      this.labels.add(text);
    });
  }
}
