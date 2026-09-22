import { describe, expect, it } from 'vitest';

import { MAX_INPUT_DT, MAX_PLAYERS, WS_MSG_MAX_BYTES } from '../src/config/constants';
import {
  channelFor,
  parseClientMessage,
  parseHostMessage,
  type HostMessage,
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

  it('round-trips every host message type', () => {
    const messages: HostMessage[] = [
      { type: 'welcome', playerId: 'a', slot: 0, tick: 1, serverTimeMs: 10, players: [player] },
      { type: 'state', tick: 2, serverTimeMs: 20, players: [player] },
      { type: 'playerJoined', player },
      { type: 'playerLeft', playerId: 'a' },
      { type: 'paused', paused: true },
      { type: 'rejected', reason: 'full' },
      { type: 'pong', t: 123 },
    ];

    for (const message of messages) {
      expect(decodeHostMessage(encode(message))).toEqual(message);
    }
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
