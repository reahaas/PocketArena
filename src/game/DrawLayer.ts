import type Phaser from 'phaser';

import { MIN_ARROW_LENGTH_PX } from '../config/constants';
import type { DrawArrow } from '../networking/NetworkProtocol';

const ARROW_COLOR = 0xfacc15;
const PREVIEW_COLOR = 0x38bdf8;
const ARROW_WIDTH = 6;
const ARROWHEAD_LENGTH = 26;

/** Draws one arrow (shaft + head) from `(x1,y1)` to `(x2,y2)` in world space. */
function drawArrow(
  graphics: Phaser.GameObjects.Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: number,
  alpha: number,
): void {
  graphics.lineStyle(ARROW_WIDTH, color, alpha);
  graphics.lineBetween(x1, y1, x2, y2);

  const angle = Math.atan2(y2 - y1, x2 - x1);
  const spread = Math.PI / 7;
  graphics.fillStyle(color, alpha);
  graphics.beginPath();
  graphics.moveTo(x2, y2);
  graphics.lineTo(
    x2 - ARROWHEAD_LENGTH * Math.cos(angle - spread),
    y2 - ARROWHEAD_LENGTH * Math.sin(angle - spread),
  );
  graphics.lineTo(
    x2 - ARROWHEAD_LENGTH * Math.cos(angle + spread),
    y2 - ARROWHEAD_LENGTH * Math.sin(angle + spread),
  );
  graphics.closePath();
  graphics.fillPath();
}

/**
 * The shared tactics board. Renders every committed arrow, and — only while draw mode is on for
 * this device — turns pointer drags into new arrows (spec-equivalent, new feature).
 */
export class DrawLayer {
  private readonly committed: Phaser.GameObjects.Graphics;
  private readonly preview: Phaser.GameObjects.Graphics;
  private drawModeEnabled = false;
  private dragStart: { x: number; y: number } | null = null;
  private onArrowDrawn: ((x1: number, y1: number, x2: number, y2: number) => void) | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    this.committed = scene.add.graphics().setDepth(50);
    this.preview = scene.add.graphics().setDepth(51);

    scene.input.on('pointerdown', this.handlePointerDown);
    scene.input.on('pointermove', this.handlePointerMove);
    scene.input.on('pointerup', this.handlePointerUp);
  }

  /** `onArrowDrawn` fires once per completed drag, in world coordinates. */
  setDrawMode(enabled: boolean, onArrowDrawn: (x1: number, y1: number, x2: number, y2: number) => void): void {
    this.drawModeEnabled = enabled;
    this.onArrowDrawn = onArrowDrawn;
    if (!enabled) {
      this.dragStart = null;
      this.preview.clear();
    }
  }

  setArrows(arrows: readonly DrawArrow[]): void {
    this.committed.clear();
    for (const arrow of arrows) {
      drawArrow(this.committed, arrow.x1, arrow.y1, arrow.x2, arrow.y2, ARROW_COLOR, 0.9);
    }
  }

  destroy(): void {
    this.scene.input.off('pointerdown', this.handlePointerDown);
    this.scene.input.off('pointermove', this.handlePointerMove);
    this.scene.input.off('pointerup', this.handlePointerUp);
    this.committed.destroy();
    this.preview.destroy();
  }

  private readonly handlePointerDown = (pointer: Phaser.Input.Pointer): void => {
    if (!this.drawModeEnabled) return;
    this.dragStart = { x: pointer.worldX, y: pointer.worldY };
  };

  private readonly handlePointerMove = (pointer: Phaser.Input.Pointer): void => {
    if (!this.drawModeEnabled || !this.dragStart) return;
    this.preview.clear();
    drawArrow(
      this.preview,
      this.dragStart.x,
      this.dragStart.y,
      pointer.worldX,
      pointer.worldY,
      PREVIEW_COLOR,
      0.7,
    );
  };

  private readonly handlePointerUp = (pointer: Phaser.Input.Pointer): void => {
    if (!this.drawModeEnabled || !this.dragStart) return;

    const start = this.dragStart;
    this.dragStart = null;
    this.preview.clear();

    const length = Math.hypot(pointer.worldX - start.x, pointer.worldY - start.y);
    if (length < MIN_ARROW_LENGTH_PX) return;

    this.onArrowDrawn?.(start.x, start.y, pointer.worldX, pointer.worldY);
  };
}
