import { MAX_INPUT_DT, MAX_PLAYERS, SPORTS } from '../config/constants';
import type { SportType } from '../config/constants';
import type { PlayerState } from '../game/types';
import { clamp, sanitizeNumber } from '../utils/math';

export type ChannelKind = 'reliable' | 'unreliable';

/** Wire representation of a player. `ack` is the last input sequence the host processed for them. */
export interface NetPlayer extends PlayerState {
  ack: number;
}

export type ClientMessage =
  | { type: 'input'; sequence: number; x: number; y: number; dt: number }
  | { type: 'ping'; t: number };

export type HostMessage =
  | {
      type: 'welcome';
      playerId: string;
      slot: number;
      tick: number;
      serverTimeMs: number;
      players: NetPlayer[];
      sport: SportType;
    }
  | { type: 'state'; tick: number; serverTimeMs: number; players: NetPlayer[] }
  | { type: 'playerJoined'; player: NetPlayer }
  | { type: 'playerLeft'; playerId: string }
  | { type: 'paused'; paused: boolean }
  | { type: 'sport'; sport: SportType }
  | { type: 'rejected'; reason: 'full' }
  | { type: 'pong'; t: number };

/**
 * Snapshots and inputs go unreliable/unordered: a stale snapshot is worthless, and waiting for
 * its retransmission would head-of-line block every fresher one. Lifecycle messages must arrive.
 */
export function channelFor(type: ClientMessage['type'] | HostMessage['type']): ChannelKind {
  switch (type) {
    case 'input':
    case 'state':
    case 'ping':
    case 'pong':
      return 'unreliable';
    default:
      return 'reliable';
  }
}

// --- Validation ---------------------------------------------------------
// Nothing arriving from a peer is trusted. Every field is type-checked and clamped (spec §34).

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseSequence(value: unknown): number | null {
  const n = sanitizeNumber(value, -1);
  if (!Number.isInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) return null;
  return n;
}

function parseSport(value: unknown): SportType | null {
  return typeof value === 'string' && (SPORTS as string[]).includes(value)
    ? (value as SportType)
    : null;
}

function parseNetPlayer(value: unknown): NetPlayer | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 64) return null;

  const slot = sanitizeNumber(value.slot, -1);
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_PLAYERS) return null;

  return {
    id: value.id,
    slot,
    x: sanitizeNumber(value.x),
    y: sanitizeNumber(value.y),
    vx: sanitizeNumber(value.vx),
    vy: sanitizeNumber(value.vy),
    ack: Math.max(0, Math.trunc(sanitizeNumber(value.ack))),
  };
}

function parsePlayerList(value: unknown): NetPlayer[] | null {
  if (!Array.isArray(value) || value.length > MAX_PLAYERS) return null;

  const players: NetPlayer[] = [];
  for (const entry of value) {
    const player = parseNetPlayer(entry);
    if (!player) return null;
    players.push(player);
  }
  return players;
}

export function parseClientMessage(value: unknown): ClientMessage | null {
  if (!isRecord(value)) return null;

  switch (value.type) {
    case 'input': {
      const sequence = parseSequence(value.sequence);
      if (sequence === null) return null;
      return {
        type: 'input',
        sequence,
        x: clamp(sanitizeNumber(value.x), -1, 1),
        y: clamp(sanitizeNumber(value.y), -1, 1),
        dt: clamp(sanitizeNumber(value.dt), 0, MAX_INPUT_DT),
      };
    }
    case 'ping':
      return { type: 'ping', t: sanitizeNumber(value.t) };
    default:
      return null;
  }
}

export function parseHostMessage(value: unknown): HostMessage | null {
  if (!isRecord(value)) return null;

  switch (value.type) {
    case 'welcome': {
      const players = parsePlayerList(value.players);
      const slot = sanitizeNumber(value.slot, -1);
      const sport = parseSport(value.sport);
      if (!players || typeof value.playerId !== 'string' || !sport) return null;
      if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_PLAYERS) return null;
      return {
        type: 'welcome',
        playerId: value.playerId,
        slot,
        tick: Math.max(0, Math.trunc(sanitizeNumber(value.tick))),
        serverTimeMs: sanitizeNumber(value.serverTimeMs),
        players,
        sport,
      };
    }
    case 'state': {
      const players = parsePlayerList(value.players);
      if (!players) return null;
      return {
        type: 'state',
        tick: Math.max(0, Math.trunc(sanitizeNumber(value.tick))),
        serverTimeMs: sanitizeNumber(value.serverTimeMs),
        players,
      };
    }
    case 'playerJoined': {
      const player = parseNetPlayer(value.player);
      return player ? { type: 'playerJoined', player } : null;
    }
    case 'playerLeft':
      return typeof value.playerId === 'string'
        ? { type: 'playerLeft', playerId: value.playerId }
        : null;
    case 'paused':
      return { type: 'paused', paused: value.paused === true };
    case 'sport': {
      const sport = parseSport(value.sport);
      return sport ? { type: 'sport', sport } : null;
    }
    case 'rejected':
      return value.reason === 'full' ? { type: 'rejected', reason: 'full' } : null;
    case 'pong':
      return { type: 'pong', t: sanitizeNumber(value.t) };
    default:
      return null;
  }
}
