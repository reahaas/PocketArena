import { describe, expect, it } from 'vitest';

import { PLAYER_SPEED } from '../src/config/constants';
import { minimumPlaybookStepDurationMs } from '../src/game/PlaybookMath';

describe('minimumPlaybookStepDurationMs', () => {
  it('calculates the fastest travel time and rounds upward to the editor precision', () => {
    expect(minimumPlaybookStepDurationMs({ x: 0, y: 0 }, { x: PLAYER_SPEED, y: 0 })).toBe(1000);
    expect(minimumPlaybookStepDurationMs({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(10);
    expect(minimumPlaybookStepDurationMs({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(10);
  });

  it('rounds diagonal distance from actual speed, not per-axis speed', () => {
    const distance = Math.hypot(PLAYER_SPEED, PLAYER_SPEED);
    expect(minimumPlaybookStepDurationMs({ x: 0, y: 0 }, { x: PLAYER_SPEED, y: PLAYER_SPEED })).toBe(
      Math.ceil((distance / PLAYER_SPEED) * 100) * 10,
    );
  });
});
