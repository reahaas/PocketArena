import type Phaser from 'phaser';

import { TEAM_COLORS } from '../config/constants';
import type { TeamId } from '../config/constants';
import type { PlaybookAssignment, Play } from '../networking/NetworkProtocol';
import { expectedPlaybookPosition } from './PlaybookMath';

const OTHER_ALPHA = 0.35;
const EDIT_ALPHA = 0.6;
const MINE_ALPHA = 0.95;
const WAYPOINT_RADIUS = 10;
const GHOST_RADIUS = 16;

export interface ArmedTarget {
  team: TeamId;
  number: number;
}

function assignmentKey(team: TeamId, number: number): string {
  return `${team}:${number}`;
}

/**
 * Renders every player's assigned path (dotted waypoints, numbered in order), and — only while
 * the host has a player "armed" in the editor — turns taps into new waypoints for that
 * assignment. During a live run it also tracks a "ghost target": where the local player should
 * be right now, so they can chase it (spec-equivalent, new feature).
 */
export class PlaybookLayer {
  private readonly paths: Phaser.GameObjects.Graphics;
  private readonly ghost: Phaser.GameObjects.Graphics;
  private readonly labels: Phaser.GameObjects.Container;

  private editAssignments: readonly PlaybookAssignment[] = [];
  private editMode = false;
  private armed: ArmedTarget | null = null;
  private onWaypointPlaced: ((x: number, y: number) => void) | null = null;

  private livePlay: Play | null = null;
  private liveLocalKey: string | null = null;
  private liveStartAtLocalMs: number | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    this.paths = scene.add.graphics().setDepth(60);
    this.ghost = scene.add.graphics().setDepth(61);
    this.labels = scene.add.container(0, 0).setDepth(62);

    scene.input.on('pointerdown', this.handlePointerDown);
  }

  /** Host-only editor: while armed, tapping the field appends a waypoint for that assignment. */
  setEditMode(
    enabled: boolean,
    armed: ArmedTarget | null,
    onWaypointPlaced: (x: number, y: number) => void,
  ): void {
    this.editMode = enabled;
    this.armed = armed;
    this.onWaypointPlaced = onWaypointPlaced;
    this.redrawPaths();
  }

  /** The full draft roster, redrawn whenever any assignment's waypoints change. */
  setEditAssignments(assignments: readonly PlaybookAssignment[]): void {
    this.editAssignments = assignments;
    this.redrawPaths();
  }

  /** Set once a play is launched (countdown or running). `null` clears the overlay entirely. */
  setLiveView(play: Play | null, localTeam: TeamId | null, localNumber: number | null): void {
    this.livePlay = play;
    this.liveLocalKey =
      localTeam && localNumber !== null ? assignmentKey(localTeam, localNumber) : null;
    if (!play) this.liveStartAtLocalMs = null;
    this.redrawPaths();
  }

  /** Local-clock time grading begins; `null` while still only showing the path pre-launch. */
  setLiveStart(startAtLocalMs: number | null): void {
    this.liveStartAtLocalMs = startAtLocalMs;
  }

  /** Call once per render frame. Advances the ghost target along the local player's path. */
  update(nowMs: number): void {
    this.ghost.clear();
    if (!this.livePlay || this.liveStartAtLocalMs === null || !this.liveLocalKey) return;

    const mine = this.livePlay.assignments.find(
      (a) => assignmentKey(a.team, a.number) === this.liveLocalKey,
    );
    if (!mine) return;

    const elapsedMs = nowMs - this.liveStartAtLocalMs;
    if (elapsedMs < 0) return;

    const position = expectedPlaybookPosition(mine.waypoints, elapsedMs);
    if (!position) return;

    this.ghost.lineStyle(4, 0xfacc15, 1);
    this.ghost.strokeCircle(position.x, position.y, GHOST_RADIUS);
    this.ghost.fillStyle(0xfacc15, 0.25);
    this.ghost.fillCircle(position.x, position.y, GHOST_RADIUS);
  }

  destroy(): void {
    this.scene.input.off('pointerdown', this.handlePointerDown);
    this.paths.destroy();
    this.ghost.destroy();
    this.labels.destroy();
  }

  private readonly handlePointerDown = (pointer: Phaser.Input.Pointer): void => {
    if (!this.editMode || !this.armed || !this.onWaypointPlaced) return;
    this.onWaypointPlaced(pointer.worldX, pointer.worldY);
  };

  private redrawPaths(): void {
    this.paths.clear();
    this.labels.removeAll(true);

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
  }

  private drawAssignment(assignment: PlaybookAssignment, alpha: number, highlight: boolean): void {
    const color = TEAM_COLORS[assignment.team];
    const points = assignment.waypoints;
    if (points.length === 0) return;

    this.paths.lineStyle(highlight ? 5 : 3, color, alpha);
    for (let i = 0; i < points.length - 1; i++) {
      this.paths.lineBetween(points[i]!.x, points[i]!.y, points[i + 1]!.x, points[i + 1]!.y);
    }

    points.forEach((point, index) => {
      this.paths.fillStyle(color, alpha);
      this.paths.fillCircle(point.x, point.y, WAYPOINT_RADIUS);

      const text = this.scene.add
        .text(point.x, point.y - 24, String(index + 1), { fontSize: '16px', color: '#ffffff' })
        .setOrigin(0.5)
        .setAlpha(alpha);
      this.labels.add(text);
    });
  }
}
