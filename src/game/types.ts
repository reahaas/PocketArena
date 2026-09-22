export type PlayerId = string;

export interface Vector2 {
  x: number;
  y: number;
}

export interface PlayerState {
  id: PlayerId;
  /** 0-based seat index. Drives spawn point, colour and the `P<n>` label, stable for the session. */
  slot: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export const ZERO_VECTOR: Readonly<Vector2> = Object.freeze({ x: 0, y: 0 });
