import {
  PLAYBOOK_ACCURACY_MAX_DISTANCE_PX,
  PLAYBOOK_ACCURACY_SAMPLE_MS,
  PLAYER_RADIUS,
} from '../config/constants';
import type { Play, PlaybookAssignment } from '../networking/NetworkProtocol';
import { clamp } from '../utils/math';
import { expectedPlaybookPosition } from './PlaybookMath';
import { GameSimulation } from './GameSimulation';
import type { GameSession, RenderPlayer } from './RenderPlayer';
import type { Vector2 } from './types';

export interface PracticeStepResult {
  stepNumber: number;
  expectedMs: number;
  actualMs: number | null;
  timingAccuracyPct: number;
}

export interface PlaybookPracticeResult {
  team: PlaybookAssignment['team'];
  number: number;
  positionAccuracyPct: number;
  timingAccuracyPct: number;
  overallAccuracyPct: number;
  averageErrorPx: number;
  steps: PracticeStepResult[];
}

const TIMING_TOLERANCE_MS = 1_500;
const ARRIVAL_RADIUS_PX = PLAYER_RADIUS * 2.5;

/** Local, server-free playbook attempt controlled by the normal joystick/keyboard inputs. */
export class PlaybookPracticeSession implements GameSession {
  readonly localSlot = 0;
  readonly localPlayerId = 'playbook-practice-player';
  readonly playerCount = 1;

  private readonly simulation = new GameSimulation();
  private readonly arrivalTimes: (number | null)[];
  private totalErrorPx = 0;
  private samples = 0;
  private lastSampleMs = 0;
  private result: PlaybookPracticeResult | null = null;

  constructor(
    readonly play: Play,
    readonly assignment: PlaybookAssignment,
    private readonly startAtMs: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    const start = expectedPlaybookPosition(assignment.steps, 0);
    if (!start) throw new Error('Cannot practice an assignment with no steps.');
    this.simulation.addPlayer(this.localPlayerId, this.localSlot, start.x, start.y);
    this.arrivalTimes = assignment.steps.map(() => null);
  }

  submitInput(input: Vector2, dtSeconds: number): void {
    if (this.result) return;
    if (this.now() < this.startAtMs) return;
    this.simulation.step(this.localPlayerId, input, dtSeconds);
    this.sample(this.now());
  }

  renderPlayers(_nowMs: number): RenderPlayer[] {
    const player = this.simulation.getPlayer(this.localPlayerId);
    return player
      ? [{ id: player.id, slot: player.slot, x: player.x, y: player.y, isLocal: true }]
      : [];
  }

  finish(): PlaybookPracticeResult {
    if (this.result) return this.result;

    const averageErrorPx = this.samples > 0 ? this.totalErrorPx / this.samples : PLAYBOOK_ACCURACY_MAX_DISTANCE_PX;
    const positionAccuracyPct = clamp(
      (1 - averageErrorPx / PLAYBOOK_ACCURACY_MAX_DISTANCE_PX) * 100,
      0,
      100,
    );
    const steps = this.assignment.steps
      .map((step, index) => ({ step, index }))
      .sort((a, b) => a.step.startMs - b.step.startMs)
      .map(({ step, index }): PracticeStepResult => {
        const actualMs = this.arrivalTimes[index] ?? null;
        const expectedMs = step.durationMs;
        const timingAccuracyPct =
          actualMs === null
            ? 0
            : clamp((1 - Math.abs(actualMs - expectedMs) / TIMING_TOLERANCE_MS) * 100, 0, 100);
        return { stepNumber: index + 1, expectedMs, actualMs, timingAccuracyPct };
      });
    const timingAccuracyPct =
      steps.length > 0 ? steps.reduce((sum, step) => sum + step.timingAccuracyPct, 0) / steps.length : 0;

    this.result = {
      team: this.assignment.team,
      number: this.assignment.number,
      positionAccuracyPct,
      timingAccuracyPct,
      overallAccuracyPct: positionAccuracyPct * 0.7 + timingAccuracyPct * 0.3,
      averageErrorPx,
      steps,
    };
    return this.result;
  }

  destroy(): void {
    this.simulation.clear();
  }

  private sample(nowMs: number): void {
    const elapsedMs = Math.max(0, nowMs - this.startAtMs);
    if (nowMs - this.lastSampleMs >= PLAYBOOK_ACCURACY_SAMPLE_MS) {
      this.lastSampleMs = nowMs;
      const actual = this.simulation.getPlayer(this.localPlayerId);
      const expected = expectedPlaybookPosition(this.assignment.steps, elapsedMs);
      if (actual && expected) {
        this.totalErrorPx += Math.hypot(actual.x - expected.x, actual.y - expected.y);
        this.samples += 1;
      }
    }

    const actual = this.simulation.getPlayer(this.localPlayerId);
    if (!actual) return;
    const sortedSteps = this.assignment.steps
      .map((step, index) => ({ step, index }))
      .sort((a, b) => a.step.startMs - b.step.startMs);
    for (const { step, index } of sortedSteps) {
      if (this.arrivalTimes[index] !== null || elapsedMs < step.startMs) continue;
      if (Math.hypot(actual.x - step.toX, actual.y - step.toY) <= ARRIVAL_RADIUS_PX) {
        this.arrivalTimes[index] = Math.max(0, elapsedMs - step.startMs);
      }
    }
  }
}
