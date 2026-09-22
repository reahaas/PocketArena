import type { Vector2 } from '../game/types';

/**
 * A single way of producing movement intent. The virtual joystick and the keyboard both
 * implement this so there is exactly one movement path (spec §21).
 */
export interface InputSource {
  read(): Vector2;
  isActive(): boolean;
  destroy(): void;
}
