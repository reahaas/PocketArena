import type Phaser from 'phaser';

import { ARENA_HEIGHT, ARENA_WIDTH } from '../config/constants';
import type { SportType } from '../config/constants';
import { drawFieldMarkings } from './FieldMarkings';

const GRID_SPACING = 100;
const GRID_COLOR = 0x1e293b;
const BORDER_COLOR = 0x38bdf8;

export class Arena {
  private readonly fieldLines: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    const graphics = scene.add.graphics();
    graphics.setDepth(-10);

    graphics.fillStyle(0x0b1120, 1);
    graphics.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

    graphics.lineStyle(1, GRID_COLOR, 0.8);
    for (let x = GRID_SPACING; x < ARENA_WIDTH; x += GRID_SPACING) {
      graphics.lineBetween(x, 0, x, ARENA_HEIGHT);
    }
    for (let y = GRID_SPACING; y < ARENA_HEIGHT; y += GRID_SPACING) {
      graphics.lineBetween(0, y, ARENA_WIDTH, y);
    }

    graphics.lineStyle(4, BORDER_COLOR, 0.9);
    graphics.strokeRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

    this.fieldLines = scene.add.graphics();
    this.fieldLines.setDepth(-5);

    scene.cameras.main.setBounds(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
  }

  /** Redraws the sport-specific field/court/pool markings, replacing whatever was drawn before. */
  setSport(sport: SportType): void {
    this.fieldLines.clear();
    drawFieldMarkings(this.fieldLines, sport);
  }
}
