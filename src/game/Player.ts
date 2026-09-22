import type Phaser from 'phaser';

import { PLAYER_RADIUS } from '../config/constants';
import { colorForSlot, labelForSlot } from '../utils/palette';

/** One circle plus its label. Created once per player and reused until they leave. */
export class Player {
  private readonly container: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Arc;
  private readonly ring: Phaser.GameObjects.Arc;

  constructor(scene: Phaser.Scene, slot: number, isLocal: boolean) {
    this.body = scene.add.circle(0, 0, PLAYER_RADIUS, colorForSlot(slot));

    this.ring = scene.add.circle(0, 0, PLAYER_RADIUS + 4);
    this.ring.setStrokeStyle(3, 0xffffff, isLocal ? 0.95 : 0.25);
    this.ring.setFillStyle();

    const label = scene.add.text(0, -PLAYER_RADIUS - 20, labelForSlot(slot), {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '18px',
      color: '#e2e8f0',
    });
    label.setOrigin(0.5, 0.5);

    this.container = scene.add.container(0, 0, [this.ring, this.body, label]);
    this.container.setDepth(isLocal ? 10 : 5);
  }

  setPosition(x: number, y: number): void {
    this.container.setPosition(x, y);
  }

  setSlot(slot: number, isLocal: boolean): void {
    this.body.setFillStyle(colorForSlot(slot));
    this.ring.setStrokeStyle(3, 0xffffff, isLocal ? 0.95 : 0.25);
    this.container.setDepth(isLocal ? 10 : 5);
  }

  destroy(): void {
    this.container.destroy(true);
  }
}
