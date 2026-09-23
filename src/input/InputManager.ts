import type { Vector2 } from '../game/types';
import { ZERO_VECTOR } from '../game/types';
import type { InputSource } from './InputSource';
import { KeyboardInput } from './KeyboardInput';
import { VirtualJoystick } from './VirtualJoystick';

/**
 * Merges every input source into the one vector the simulation consumes.
 * Sources are consulted in priority order, so touching the joystick always wins over a
 * stuck keyboard key and vice versa.
 */
export class InputManager {
  private readonly sources: InputSource[];

  constructor(private readonly joystick: VirtualJoystick, keyboard: KeyboardInput) {
    this.sources = [joystick, keyboard];
  }

  static create(uiRoot: HTMLElement): InputManager {
    return new InputManager(new VirtualJoystick(uiRoot), new KeyboardInput());
  }

  read(): Vector2 {
    for (const source of this.sources) {
      if (source.isActive()) return source.read();
    }
    return { ...ZERO_VECTOR };
  }

  get joystickElement(): VirtualJoystick {
    return this.joystick;
  }

  /** Disabled while draw mode is on, so drags reach the tactics board instead of the stick. */
  setJoystickEnabled(enabled: boolean): void {
    this.joystick.setEnabled(enabled);
  }

  destroy(): void {
    for (const source of this.sources) source.destroy();
  }
}
