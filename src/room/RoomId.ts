import { ROOM_ID_ALPHABET, ROOM_ID_LENGTH } from '../config/constants';

/**
 * Cryptographically random, never sequential (spec §33). The alphabet is 32 characters, so
 * masking a random byte with 31 is unbiased — no rejection sampling needed.
 */
export function generateRoomId(length: number = ROOM_ID_LENGTH): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);

  let id = '';
  for (const byte of bytes) {
    id += ROOM_ID_ALPHABET[byte & (ROOM_ID_ALPHABET.length - 1)];
  }
  return id;
}

/**
 * `crypto.randomUUID` only exists in secure contexts, so it is missing when the game is served
 * over plain HTTP on a LAN address — exactly how a phone reaches a dev machine. `getRandomValues`
 * has no such restriction, so fall back to building the v4 UUID by hand.
 */
export function generatePlayerId(): string {
  const native = globalThis.crypto.randomUUID;
  if (typeof native === 'function') return native.call(globalThis.crypto);

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}
