import { WS_MSG_MAX_BYTES } from '../config/constants';
import type { ClientMessage, HostMessage } from './NetworkProtocol';
import { parseClientMessage, parseHostMessage } from './NetworkProtocol';

/**
 * JSON for the MVP, but every call site goes through here so binary encoding can replace it
 * without touching gameplay or transport code (spec §28).
 */
export function encode(message: ClientMessage | HostMessage): string {
  return JSON.stringify(message);
}

function decodeRaw(raw: string): unknown {
  if (raw.length > WS_MSG_MAX_BYTES) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function decodeClientMessage(raw: string): ClientMessage | null {
  return parseClientMessage(decodeRaw(raw));
}

export function decodeHostMessage(raw: string): HostMessage | null {
  return parseHostMessage(decodeRaw(raw));
}
