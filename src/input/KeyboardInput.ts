import type { Vector2 } from '../game/types';
import type { InputSource } from './InputSource';

const LEFT_KEYS = new Set(['KeyA', 'ArrowLeft']);
const RIGHT_KEYS = new Set(['KeyD', 'ArrowRight']);
const UP_KEYS = new Set(['KeyW', 'ArrowUp']);
const DOWN_KEYS = new Set(['KeyS', 'ArrowDown']);

export class KeyboardInput implements InputSource {
  private readonly pressed = new Set<string>();

  constructor(private readonly target: Window = window) {
    this.target.addEventListener('keydown', this.onKeyDown);
    this.target.addEventListener('keyup', this.onKeyUp);
    this.target.addEventListener('blur', this.onBlur);
  }

  read(): Vector2 {
    let x = 0;
    let y = 0;
    for (const code of this.pressed) {
      if (LEFT_KEYS.has(code)) x -= 1;
      if (RIGHT_KEYS.has(code)) x += 1;
      if (UP_KEYS.has(code)) y -= 1;
      if (DOWN_KEYS.has(code)) y += 1;
    }
    // Diagonals are left at magnitude sqrt(2); stepPlayer clamps them back to 1.
    return { x, y };
  }

  isActive(): boolean {
    const { x, y } = this.read();
    return x !== 0 || y !== 0;
  }

  destroy(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.pressed.clear();
  }

  private isTracked(code: string): boolean {
    return LEFT_KEYS.has(code) || RIGHT_KEYS.has(code) || UP_KEYS.has(code) || DOWN_KEYS.has(code);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.isTracked(event.code)) return;
    this.pressed.add(event.code);
    event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.pressed.clear();
  };
}
