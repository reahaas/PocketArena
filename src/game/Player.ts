import type Phaser from 'phaser';

import { PLAYER_RADIUS, TEAM_COLORS } from '../config/constants';
import type { TeamId } from '../config/constants';
import { colorForSlot, labelForSlot } from '../utils/palette';

/** One circle plus its jersey number. Created once per player and reused until they leave. */
export class Player {
  private readonly container: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Arc;
  private readonly ring: Phaser.GameObjects.Arc;
  private readonly label: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, slot: number, isLocal: boolean) {
    // Falls back to a per-slot colour/label until the host's roster message arrives.
    this.body = scene.add.circle(0, 0, PLAYER_RADIUS, colorForSlot(slot));

    this.ring = scene.add.circle(0, 0, PLAYER_RADIUS + 4);
    this.ring.setStrokeStyle(3, 0xffffff, isLocal ? 0.95 : 0.25);
    this.ring.setFillStyle();

    this.label = scene.add.text(0, 0, labelForSlot(slot).replace('P', ''), {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '16px',
      fontStyle: 'bold',
      color: '#020617',
    });
    this.label.setOrigin(0.5, 0.5);

    this.container = scene.add.container(0, 0, [this.ring, this.body, this.label]);
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

  /** Applies the host-assigned team colour and jersey number once the roster is known. */
  setRoster(team: TeamId, number: number): void {
    this.body.setFillStyle(TEAM_COLORS[team]);
    this.label.setText(String(number));
  }

  destroy(): void {
    this.container.destroy(true);
  }
}
