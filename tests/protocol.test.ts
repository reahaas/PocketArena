import { describe, expect, it } from 'vitest';

import {
  MAX_INPUT_DT,
  MAX_PLAYERS,
  MAX_STEPS_PER_ASSIGNMENT,
  PLAYBOOK_MAX_DURATION_MS,
  WS_MSG_MAX_BYTES,
} from '../src/config/constants';
import {
  channelFor,
  parseClientMessage,
  parseHostMessage,
  parsePlay,
  type HostMessage,
  type Play,
} from '../src/networking/NetworkProtocol';
import {
  decodeClientMessage,
  decodeHostMessage,
  encode,
} from '../src/networking/NetworkSerializer';
import { parseSignalingClientMessage } from '../src/networking/SignalingProtocol';

describe('channel routing', () => {
  it('sends time-sensitive traffic unreliably and lifecycle traffic reliably', () => {
    expect(channelFor('input')).toBe('unreliable');
    expect(channelFor('state')).toBe('unreliable');
    expect(channelFor('welcome')).toBe('reliable');
    expect(channelFor('playerJoined')).toBe('reliable');
    expect(channelFor('playerLeft')).toBe('reliable');
    expect(channelFor('rejected')).toBe('reliable');
  });
});

describe('client message validation', () => {
  it('round-trips a valid input', () => {
    const message = { type: 'input', sequence: 7, x: 0.5, y: -0.25, dt: 0.05 } as const;
    expect(decodeClientMessage(encode(message))).toEqual(message);
  });

  it('round-trips a jersey number claim', () => {
    const message = { type: 'claimNumber', number: 12 } as const;
    expect(decodeClientMessage(encode(message))).toEqual(message);
  });

  it('rejects a jersey number outside the valid range', () => {
    expect(parseClientMessage({ type: 'claimNumber', number: 0 })).toBeNull();
    expect(parseClientMessage({ type: 'claimNumber', number: 51 })).toBeNull();
    expect(parseClientMessage({ type: 'claimNumber', number: 1.5 })).toBeNull();
  });

  it('round-trips a drawn arrow', () => {
    const message = { type: 'drawArrow', x1: 1, y1: 2, x2: 3, y2: 4 } as const;
    expect(decodeClientMessage(encode(message))).toEqual(message);
  });

  it('replaces NaN coordinates in a drawn arrow with zero', () => {
    const parsed = parseClientMessage({
      type: 'drawArrow',
      x1: Number.NaN,
      y1: 2,
      x2: 3,
      y2: Number.POSITIVE_INFINITY,
    });
    expect(parsed).toEqual({ type: 'drawArrow', x1: 0, y1: 2, x2: 3, y2: 0 });
  });

  it('round-trips a clear-my-drawings request', () => {
    const message = { type: 'clearMyDrawings' } as const;
    expect(decodeClientMessage(encode(message))).toEqual(message);
  });

  it('clamps joystick values that are out of range', () => {
    const parsed = parseClientMessage({ type: 'input', sequence: 1, x: 999, y: -999, dt: 0.05 });
    expect(parsed).toEqual({ type: 'input', sequence: 1, x: 1, y: -1, dt: 0.05 });
  });

  it('clamps a forged delta', () => {
    const parsed = parseClientMessage({ type: 'input', sequence: 1, x: 0, y: 0, dt: 9999 });
    expect(parsed).toMatchObject({ dt: MAX_INPUT_DT });
  });

  it('replaces NaN and Infinity with zero', () => {
    const parsed = parseClientMessage({
      type: 'input',
      sequence: 1,
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY,
      dt: Number.NaN,
    });
    expect(parsed).toEqual({ type: 'input', sequence: 1, x: 0, y: 0, dt: 0 });
  });

  it('rejects negative and non-integer sequence numbers', () => {
    expect(parseClientMessage({ type: 'input', sequence: -1, x: 0, y: 0, dt: 0 })).toBeNull();
    expect(parseClientMessage({ type: 'input', sequence: 1.5, x: 0, y: 0, dt: 0 })).toBeNull();
    expect(parseClientMessage({ type: 'input', sequence: 'x', x: 0, y: 0, dt: 0 })).toBeNull();
  });

  it('rejects unknown, malformed and empty payloads', () => {
    expect(decodeClientMessage('not json')).toBeNull();
    expect(decodeClientMessage('null')).toBeNull();
    expect(decodeClientMessage('[]')).toBeNull();
    expect(parseClientMessage({ type: 'teleport', x: 999999 })).toBeNull();
    expect(parseClientMessage(undefined)).toBeNull();
  });

  it('rejects oversized payloads before parsing them', () => {
    const huge = JSON.stringify({ type: 'input', pad: 'a'.repeat(WS_MSG_MAX_BYTES) });
    expect(decodeClientMessage(huge)).toBeNull();
  });
});

describe('host message validation', () => {
  const player = { id: 'a', slot: 0, x: 1, y: 2, vx: 3, vy: 4, ack: 5 };
  const rosterEntry = { playerId: 'a', slot: 0, team: 'A' as const, number: 7 };
  const arrow = { id: 'arrow-1', playerId: 'a', x1: 1, y1: 2, x2: 3, y2: 4 };

  it('round-trips every host message type', () => {
    const messages: HostMessage[] = [
      {
        type: 'welcome',
        playerId: 'a',
        slot: 0,
        tick: 1,
        serverTimeMs: 10,
        players: [player],
        sport: 'soccer',
      },
      { type: 'state', tick: 2, serverTimeMs: 20, players: [player] },
      { type: 'playerJoined', player },
      { type: 'playerLeft', playerId: 'a' },
      { type: 'paused', paused: true },
      { type: 'sport', sport: 'waterpolo' },
      {
        type: 'roster',
        entries: [rosterEntry],
        reserved: [{ team: 'B', number: 9 }],
      },
      { type: 'drawEnabled', enabled: true },
      { type: 'arrows', arrows: [arrow] },
      { type: 'rejected', reason: 'full' },
      { type: 'pong', t: 123 },
    ];

    for (const message of messages) {
      expect(decodeHostMessage(encode(message))).toEqual(message);
    }
  });

  it('rejects a roster entry with an unknown team or out-of-range number', () => {
    expect(
      parseHostMessage({ type: 'roster', entries: [{ ...rosterEntry, team: 'C' }], reserved: [] }),
    ).toBeNull();
    expect(
      parseHostMessage({ type: 'roster', entries: [{ ...rosterEntry, number: 0 }], reserved: [] }),
    ).toBeNull();
  });

  it('rejects reserved numbers beyond the per-team ceiling', () => {
    const reserved = Array.from({ length: 500 }, () => ({ team: 'A' as const, number: 1 }));
    expect(parseHostMessage({ type: 'roster', entries: [], reserved })).toBeNull();
  });

  it('rejects an arrow with a missing id or player', () => {
    expect(parseHostMessage({ type: 'arrows', arrows: [{ ...arrow, id: '' }] })).toBeNull();
    expect(
      parseHostMessage({ type: 'arrows', arrows: [{ ...arrow, playerId: '' }] }),
    ).toBeNull();
  });

  it('coerces a non-boolean drawEnabled flag to false', () => {
    expect(parseHostMessage({ type: 'drawEnabled', enabled: 'yes' })).toEqual({
      type: 'drawEnabled',
      enabled: false,
    });
  });

  it('rejects a player list longer than the room limit', () => {
    const players = Array.from({ length: MAX_PLAYERS + 1 }, (_, i) => ({
      ...player,
      id: `p${i}`,
      slot: 0,
    }));
    expect(parseHostMessage({ type: 'state', tick: 1, serverTimeMs: 1, players })).toBeNull();
  });

  it('rejects out-of-range slots', () => {
    const bad = { ...player, slot: MAX_PLAYERS };
    expect(parseHostMessage({ type: 'playerJoined', player: bad })).toBeNull();
  });

  it('rejects players with a missing or absurd id', () => {
    expect(parseHostMessage({ type: 'playerJoined', player: { ...player, id: '' } })).toBeNull();
    expect(
      parseHostMessage({ type: 'playerJoined', player: { ...player, id: 'x'.repeat(65) } }),
    ).toBeNull();
  });

  it('rejects an unknown rejection reason', () => {
    expect(parseHostMessage({ type: 'rejected', reason: 'because' })).toBeNull();
  });

  it('rejects a welcome with an unrecognised sport, and a sport message with none at all', () => {
    expect(
      parseHostMessage({
        type: 'welcome',
        playerId: 'a',
        slot: 0,
        tick: 1,
        serverTimeMs: 1,
        players: [player],
        sport: 'cricket',
      }),
    ).toBeNull();
    expect(parseHostMessage({ type: 'sport', sport: 'cricket' })).toBeNull();
    expect(parseHostMessage({ type: 'sport' })).toBeNull();
  });
});

describe('playbook message validation', () => {
  const play: Play = {
    id: 'play-1',
    name: 'Post route',
    durationMs: 3000,
    assignments: [
      {
        team: 'A',
        number: 7,
        steps: [
          { startMs: 0, durationMs: 1500, fromX: 0, fromY: 0, toX: 10, toY: 10 },
        ],
      },
    ],
  };
  const grade = { team: 'A' as const, number: 7, accuracyPct: 82.5, graded: true };

  it('round-trips a play through parsePlay', () => {
    expect(parsePlay(play)).toEqual(play);
  });

  it('round-trips playbookRun, playbookResult and playbookCancel host messages', () => {
    const messages: HostMessage[] = [
      { type: 'playbookRun', play, serverStartAtMs: 1000, countdownMs: 3000 },
      { type: 'playbookResult', playId: 'play-1', playName: 'Post route', grades: [grade] },
      { type: 'playbookCancel' },
    ];

    for (const message of messages) {
      expect(decodeHostMessage(encode(message))).toEqual(message);
    }
  });

  it('rejects a play with too many steps on one assignment', () => {
    const steps = Array.from({ length: MAX_STEPS_PER_ASSIGNMENT + 1 }, (_, i) => ({
      startMs: i * 10,
      durationMs: 10,
      fromX: 0,
      fromY: 0,
      toX: 1,
      toY: 1,
    }));
    const bad = { ...play, assignments: [{ team: 'A', number: 7, steps }] };
    expect(parsePlay(bad)).toBeNull();
  });

  it('rejects a step with a non-finite or out-of-range startMs/durationMs', () => {
    const bad1 = {
      ...play,
      assignments: [
        {
          team: 'A',
          number: 7,
          steps: [{ startMs: Number.NaN, durationMs: 1000, fromX: 0, fromY: 0, toX: 1, toY: 1 }],
        },
      ],
    };
    const bad2 = {
      ...play,
      assignments: [
        {
          team: 'A',
          number: 7,
          steps: [
            { startMs: PLAYBOOK_MAX_DURATION_MS + 1, durationMs: 1000, fromX: 0, fromY: 0, toX: 1, toY: 1 },
          ],
        },
      ],
    };
    const bad3 = {
      ...play,
      assignments: [
        { team: 'A', number: 7, steps: [{ startMs: 0, durationMs: 0, fromX: 0, fromY: 0, toX: 1, toY: 1 }] },
      ],
    };
    expect(parsePlay(bad1)).toBeNull();
    expect(parsePlay(bad2)).toBeNull();
    expect(parsePlay(bad3)).toBeNull();
  });

  it('rejects an assignment with an unknown team or out-of-range number', () => {
    expect(
      parsePlay({ ...play, assignments: [{ ...play.assignments[0], team: 'C' }] }),
    ).toBeNull();
    expect(
      parsePlay({ ...play, assignments: [{ ...play.assignments[0], number: 0 }] }),
    ).toBeNull();
  });

  it('rejects a play with a missing id, empty name or non-positive duration', () => {
    expect(parsePlay({ ...play, id: '' })).toBeNull();
    expect(parsePlay({ ...play, name: '' })).toBeNull();
    expect(parsePlay({ ...play, durationMs: 0 })).toBeNull();
    expect(parsePlay({ ...play, durationMs: PLAYBOOK_MAX_DURATION_MS + 1 })).toBeNull();
  });

  it('rejects a playbookRun with an invalid play or negative countdown', () => {
    expect(
      parseHostMessage({ type: 'playbookRun', play: { ...play, id: '' }, serverStartAtMs: 0, countdownMs: 3000 }),
    ).toBeNull();
    expect(
      parseHostMessage({ type: 'playbookRun', play, serverStartAtMs: 0, countdownMs: -1 }),
    ).toBeNull();
  });

  it('rejects a playbookResult with grades beyond the assignment cap or bad fields', () => {
    expect(
      parseHostMessage({ type: 'playbookResult', playId: 'p', playName: 'n', grades: 'nope' }),
    ).toBeNull();
    expect(
      parseHostMessage({ type: 'playbookResult', playId: 1, playName: 'n', grades: [grade] }),
    ).toBeNull();
  });

  it('clamps an out-of-range accuracy and coerces a non-boolean graded flag', () => {
    const parsed = parseHostMessage({
      type: 'playbookResult',
      playId: 'p',
      playName: 'n',
      grades: [{ team: 'A', number: 7, accuracyPct: 500, graded: 'yes' }],
    });
    expect(parsed).toEqual({
      type: 'playbookResult',
      playId: 'p',
      playName: 'n',
      grades: [{ team: 'A', number: 7, accuracyPct: 100, graded: false }],
    });
  });
});

describe('signaling message validation', () => {
  it('accepts a well-formed join', () => {
    expect(parseSignalingClientMessage({ type: 'joinRoom', roomId: 'ABC123' })).toEqual({
      type: 'joinRoom',
      roomId: 'ABC123',
    });
  });

  it('rejects malformed room ids and peer ids', () => {
    expect(parseSignalingClientMessage({ type: 'joinRoom', roomId: 'abc' })).toBeNull();
    expect(
      parseSignalingClientMessage({ type: 'offer', to: 'not-a-uuid', sdp: { type: 'offer' } }),
    ).toBeNull();
  });

  it('rejects relay messages with a non-object payload', () => {
    const peerId = '11111111-2222-4333-8444-555555555555';
    expect(parseSignalingClientMessage({ type: 'ice', to: peerId, candidate: 'x' })).toBeNull();
    expect(parseSignalingClientMessage({ type: 'offer', to: peerId, sdp: null })).toBeNull();
  });

  it('rejects unknown message types', () => {
    expect(parseSignalingClientMessage({ type: 'shutdown' })).toBeNull();
  });
});
