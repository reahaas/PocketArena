import { describe, expect, it } from 'vitest';

import { ROOM_ID_ALPHABET, ROOM_ID_LENGTH } from '../src/config/constants';
import { isValidRoomId } from '../src/networking/SignalingProtocol';
import { buildInviteUrl, parseJoinPath } from '../src/room/InviteLink';
import { generatePlayerId, generateRoomId } from '../src/room/RoomId';

describe('generateRoomId', () => {
  it('produces ids of the configured length', () => {
    expect(generateRoomId()).toHaveLength(ROOM_ID_LENGTH);
  });

  it('only uses the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      for (const char of generateRoomId()) {
        expect(ROOM_ID_ALPHABET).toContain(char);
      }
    }
  });

  it('excludes characters that are easy to misread', () => {
    for (const ambiguous of ['I', 'L', 'O', 'U']) {
      expect(ROOM_ID_ALPHABET).not.toContain(ambiguous);
    }
  });

  it('is not sequential or repeating', () => {
    const ids = new Set(Array.from({ length: 500 }, () => generateRoomId()));
    expect(ids.size).toBeGreaterThan(495);
  });

  it('always passes its own validator', () => {
    for (let i = 0; i < 100; i++) {
      expect(isValidRoomId(generateRoomId())).toBe(true);
    }
  });
});

describe('generatePlayerId', () => {
  it('produces unique ids', () => {
    const ids = new Set(Array.from({ length: 500 }, () => generatePlayerId()));
    expect(ids.size).toBe(500);
  });
});

describe('invite links', () => {
  it('round-trips a room id through a url', () => {
    const roomId = generateRoomId();
    const url = buildInviteUrl(roomId, 'https://game.example.com');

    expect(url).toBe(`https://game.example.com/join/${roomId}`);
    expect(parseJoinPath(new URL(url).pathname)).toBe(roomId);
  });

  it('tolerates a trailing slash on the origin', () => {
    expect(buildInviteUrl('ABC123', 'https://x.dev/')).toBe('https://x.dev/join/ABC123');
  });

  it('accepts a lowercase room id from a mangled link', () => {
    expect(parseJoinPath('/join/abc123')).toBe('ABC123');
  });

  it('rejects paths that are not join links', () => {
    expect(parseJoinPath('/')).toBeNull();
    expect(parseJoinPath('/play/ABC123')).toBeNull();
  });

  it('rejects malformed room ids', () => {
    expect(parseJoinPath('/join/')).toBeNull();
    expect(parseJoinPath('/join/TOOLONG9')).toBeNull();
    expect(parseJoinPath('/join/ABC12')).toBeNull();
    // I, L, O and U are not in the alphabet.
    expect(parseJoinPath('/join/ILOUAB')).toBeNull();
    expect(parseJoinPath('/join/../../etc')).toBeNull();
  });
});
