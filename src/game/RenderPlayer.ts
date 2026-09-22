import type { Vector2 } from './types';

export interface RenderPlayer {
  id: string;
  slot: number;
  x: number;
  y: number;
  isLocal: boolean;
}

/** What the renderer and the app shell need, regardless of whether we are host or client. */
export interface GameSession {
  readonly localPlayerId: string;
  readonly localSlot: number;
  readonly playerCount: number;
  submitInput(input: Vector2, dtSeconds: number): void;
  renderPlayers(nowMs: number): RenderPlayer[];
  destroy(): void;
}
