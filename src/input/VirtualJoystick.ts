import { JOYSTICK_DEADZONE, JOYSTICK_RADIUS } from '../config/constants';
import type { Vector2 } from '../game/types';
import { applyDeadzone, clamp, clampMagnitude } from '../utils/math';
import type { InputSource } from './InputSource';

export class VirtualJoystick implements InputSource {
  private readonly zone: HTMLElement;
  private readonly base: HTMLElement;
  private readonly thumb: HTMLElement;

  private pointerId: number | null = null;
  private center: Vector2 = { x: 0, y: 0 };
  private offset: Vector2 = { x: 0, y: 0 };

  constructor(parent: HTMLElement) {
    this.zone = document.createElement('div');
    this.zone.className = 'joystick-zone';

    this.base = document.createElement('div');
    this.base.className = 'joystick-base';

    this.thumb = document.createElement('div');
    this.thumb.className = 'joystick-thumb';

    this.base.appendChild(this.thumb);
    this.zone.appendChild(this.base);
    parent.appendChild(this.zone);

    this.zone.addEventListener('pointerdown', this.onPointerDown);
    this.zone.addEventListener('pointermove', this.onPointerMove);
    this.zone.addEventListener('pointerup', this.onPointerUp);
    this.zone.addEventListener('pointercancel', this.onPointerUp);
  }

  read(): Vector2 {
    return applyDeadzone(this.offset, JOYSTICK_RADIUS, JOYSTICK_DEADZONE);
  }

  isActive(): boolean {
    return this.pointerId !== null;
  }

  /** Lets pointer events fall through to whatever is underneath — used while draw mode is on. */
  setEnabled(enabled: boolean): void {
    this.zone.style.pointerEvents = enabled ? '' : 'none';
    if (enabled) return;

    if (this.pointerId !== null && this.zone.hasPointerCapture(this.pointerId)) {
      this.zone.releasePointerCapture(this.pointerId);
    }
    this.pointerId = null;
    this.offset = { x: 0, y: 0 };
    this.zone.classList.remove('is-engaged');
    this.renderThumb();
  }

  destroy(): void {
    this.zone.removeEventListener('pointerdown', this.onPointerDown);
    this.zone.removeEventListener('pointermove', this.onPointerMove);
    this.zone.removeEventListener('pointerup', this.onPointerUp);
    this.zone.removeEventListener('pointercancel', this.onPointerUp);
    this.zone.remove();
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    // Track exactly one pointer; every other touch belongs to something else.
    if (this.pointerId !== null) return;

    this.pointerId = event.pointerId;
    this.zone.setPointerCapture(event.pointerId);

    // Floating: the stick appears wherever the thumb lands rather than at a fixed corner.
    this.center = this.clampToZone(event.clientX, event.clientY);
    this.base.style.left = `${this.center.x}px`;
    this.base.style.top = `${this.center.y}px`;
    this.zone.classList.add('is-engaged');

    this.updateOffset(event);
    event.preventDefault();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.updateOffset(event);
    event.preventDefault();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;

    if (this.zone.hasPointerCapture(event.pointerId)) {
      this.zone.releasePointerCapture(event.pointerId);
    }
    this.pointerId = null;
    this.offset = { x: 0, y: 0 };
    this.zone.classList.remove('is-engaged');
    this.renderThumb();
  };

  /** Keeps the whole stick on screen when the touch lands near an edge. */
  private clampToZone(clientX: number, clientY: number): Vector2 {
    const bounds = this.zone.getBoundingClientRect();
    const margin = JOYSTICK_RADIUS + 12;

    return {
      x: clamp(clientX - bounds.left, margin, Math.max(margin, bounds.width - margin)),
      y: clamp(clientY - bounds.top, margin, Math.max(margin, bounds.height - margin)),
    };
  }

  private updateOffset(event: PointerEvent): void {
    const bounds = this.zone.getBoundingClientRect();
    this.offset = clampMagnitude(
      {
        x: event.clientX - bounds.left - this.center.x,
        y: event.clientY - bounds.top - this.center.y,
      },
      JOYSTICK_RADIUS,
    );
    this.renderThumb();
  }

  private renderThumb(): void {
    this.thumb.style.transform = `translate(calc(-50% + ${this.offset.x}px), calc(-50% + ${this.offset.y}px))`;
  }
}
