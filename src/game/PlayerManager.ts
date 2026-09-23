import type Phaser from 'phaser';

import type { TeamId } from '../config/constants';
import { Player } from './Player';
import type { RenderPlayer } from './RenderPlayer';

export interface RosterLookup {
  team: TeamId;
  number: number;
}

/**
 * Keeps sprites in sync with whatever the session reports. Sprites are created and destroyed
 * only when players join or leave — never per frame (spec §29).
 */
export class PlayerManager {
  private readonly sprites = new Map<string, Player>();
  private readonly seen = new Set<string>();
  private roster = new Map<string, RosterLookup>();

  constructor(private readonly scene: Phaser.Scene) {}

  /** The team/jersey assignment is pushed separately from physics, at its own (low) rate. */
  setRoster(entries: readonly { playerId: string; team: TeamId; number: number }[]): void {
    this.roster = new Map(entries.map((entry) => [entry.playerId, entry]));
    for (const [id, sprite] of this.sprites) {
      const info = this.roster.get(id);
      if (info) sprite.setRoster(info.team, info.number);
    }
  }

  sync(players: readonly RenderPlayer[]): void {
    this.seen.clear();

    for (const player of players) {
      this.seen.add(player.id);

      let sprite = this.sprites.get(player.id);
      if (!sprite) {
        sprite = new Player(this.scene, player.slot, player.isLocal);
        this.sprites.set(player.id, sprite);
        const info = this.roster.get(player.id);
        if (info) sprite.setRoster(info.team, info.number);
      }
      sprite.setPosition(player.x, player.y);
    }

    for (const [id, sprite] of this.sprites) {
      if (this.seen.has(id)) continue;
      sprite.destroy();
      this.sprites.delete(id);
    }
  }

  destroy(): void {
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
  }
}
