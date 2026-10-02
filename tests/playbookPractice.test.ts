import { describe, expect, it } from 'vitest';

import type { Play } from '../src/networking/NetworkProtocol';
import { PlaybookPracticeSession } from '../src/game/PlaybookPractice';

const play: Play = {
  id: 'practice',
  name: 'Practice',
  durationMs: 500,
  assignments: [
    {
      team: 'A',
      number: 4,
      steps: [{ startMs: 0, durationMs: 500, fromX: 500, fromY: 500, toX: 660, toY: 500 }],
    },
  ],
};

describe('PlaybookPracticeSession', () => {
  it('scores movement position and timing while rendering the controlled player', () => {
    let nowMs = 0;
    const session = new PlaybookPracticeSession(play, play.assignments[0]!, 0, () => nowMs);

    expect(session.renderPlayers(nowMs)[0]).toMatchObject({ x: 500, y: 500, isLocal: true });
    for (let frame = 0; frame < 25; frame++) {
      nowMs += 20;
      session.submitInput({ x: 1, y: 0 }, 0.02);
    }

    const result = session.finish();
    expect(result.positionAccuracyPct).toBeGreaterThan(95);
    expect(result.timingAccuracyPct).toBeGreaterThan(80);
    expect(result.overallAccuracyPct).toBeGreaterThan(90);
    expect(result.steps[0]?.actualMs).not.toBeNull();
    expect(result).toEqual(session.finish());
  });

  it('scores a missed step as zero timing accuracy', () => {
    let nowMs = 0;
    const session = new PlaybookPracticeSession(play, play.assignments[0]!, 0, () => nowMs);
    for (let frame = 0; frame < 25; frame++) {
      nowMs += 20;
      session.submitInput({ x: 0, y: 0 }, 0.02);
    }

    const result = session.finish();
    expect(result.steps[0]?.actualMs).toBeNull();
    expect(result.timingAccuracyPct).toBe(0);
  });

  it('rejects an assignment without movement steps', () => {
    expect(
      () =>
        new PlaybookPracticeSession(
          play,
          { team: 'A', number: 4, steps: [] },
          0,
        ),
    ).toThrow('Cannot practice an assignment with no steps.');
  });
});
