import { MAX_INPUT_DT, MAX_PLAYERS, NUMBER_MAX, NUMBER_MIN, SPORTS, TEAMS } from '../config/constants';
import type { SportType, TeamId } from '../config/constants';
import type { PlayerState } from '../game/types';
import { clamp, sanitizeNumber } from '../utils/math';

export type ChannelKind = 'reliable' | 'unreliable';

/** Wire representation of a player. `ack` is the last input sequence the host processed for them. */
export interface NetPlayer extends PlayerState {
  ack: number;
}

/** Team/jersey assignment for one connected player, kept separate from the physics snapshot. */
export interface RosterEntry {
  playerId: string;
  slot: number;
  team: TeamId;
  number: number;
}

/** A number still held in grace after its owner disconnected — unavailable, but not assigned. */
export interface ReservedNumber {
  team: TeamId;
  number: number;
}

/** One tactics-board arrow. Coordinates are in arena world-space, so every device agrees. */
export interface DrawArrow {
  id: string;
  playerId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type ClientMessage =
  | { type: 'input'; sequence: number; x: number; y: number; dt: number }
  | { type: 'ping'; t: number }
  | { type: 'claimNumber'; number: number }
  | { type: 'drawArrow'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'clearMyDrawings' };

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
  | { type: 'roster'; entries: RosterEntry[]; reserved: ReservedNumber[] }
  | { type: 'drawEnabled'; enabled: boolean }
  | { type: 'arrows'; arrows: DrawArrow[] }
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

function parseTeam(value: unknown): TeamId | null {
  return typeof value === 'string' && (TEAMS as string[]).includes(value) ? (value as TeamId) : null;
}

function parseJerseyNumber(value: unknown): number | null {
  const n = sanitizeNumber(value, -1);
  if (!Number.isInteger(n) || n < NUMBER_MIN || n > NUMBER_MAX) return null;
  return n;
}

function parseRosterEntry(value: unknown): RosterEntry | null {
  if (!isRecord(value)) return null;
  if (typeof value.playerId !== 'string' || value.playerId.length === 0) return null;

  const slot = sanitizeNumber(value.slot, -1);
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_PLAYERS) return null;

  const team = parseTeam(value.team);
  const number = parseJerseyNumber(value.number);
  if (!team || number === null) return null;

  return { playerId: value.playerId, slot, team, number };
}

function parseRoster(value: unknown): RosterEntry[] | null {
  if (!Array.isArray(value) || value.length > MAX_PLAYERS) return null;

  const entries: RosterEntry[] = [];
  for (const entry of value) {
    const parsed = parseRosterEntry(entry);
    if (!parsed) return null;
    entries.push(parsed);
  }
  return entries;
}

function parseReserved(value: unknown): ReservedNumber[] | null {
  if (!Array.isArray(value) || value.length > NUMBER_MAX * TEAMS.length) return null;

  const reserved: ReservedNumber[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const team = parseTeam(entry.team);
    const number = parseJerseyNumber(entry.number);
    if (!team || number === null) return null;
    reserved.push({ team, number });
  }
  return reserved;
}

function parseArrow(value: unknown): DrawArrow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 64) return null;
  if (typeof value.playerId !== 'string' || value.playerId.length === 0) return null;

  return {
    id: value.id,
    playerId: value.playerId,
    x1: sanitizeNumber(value.x1),
    y1: sanitizeNumber(value.y1),
    x2: sanitizeNumber(value.x2),
    y2: sanitizeNumber(value.y2),
  };
}

function parseArrows(value: unknown): DrawArrow[] | null {
  if (!Array.isArray(value)) return null;

  const arrows: DrawArrow[] = [];
  for (const entry of value) {
    const arrow = parseArrow(entry);
    if (!arrow) return null;
    arrows.push(arrow);
  }
  return arrows;
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
    case 'claimNumber': {
      const number = parseJerseyNumber(value.number);
      return number === null ? null : { type: 'claimNumber', number };
    }
    case 'drawArrow':
      return {
        type: 'drawArrow',
        x1: sanitizeNumber(value.x1),
        y1: sanitizeNumber(value.y1),
        x2: sanitizeNumber(value.x2),
        y2: sanitizeNumber(value.y2),
      };
    case 'clearMyDrawings':
      return { type: 'clearMyDrawings' };
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
    case 'roster': {
      const entries = parseRoster(value.entries);
      const reserved = parseReserved(value.reserved);
      return entries && reserved ? { type: 'roster', entries, reserved } : null;
    }
    case 'drawEnabled':
      return { type: 'drawEnabled', enabled: value.enabled === true };
    case 'arrows': {
      const arrows = parseArrows(value.arrows);
      return arrows ? { type: 'arrows', arrows } : null;
    }
    case 'rejected':
      return value.reason === 'full' ? { type: 'rejected', reason: 'full' } : null;
    case 'pong':
      return { type: 'pong', t: sanitizeNumber(value.t) };
    default:
      return null;
  }
}

