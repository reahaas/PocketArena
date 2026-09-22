import { randomBytes } from 'node:crypto';

import {
  MAX_PLAYERS,
  MAX_ROOMS,
  ROOM_EMPTY_TTL_MS,
  ROOM_HOST_GRACE_MS,
  ROOM_IDLE_TTL_MS,
} from '../../src/config/constants';
import { generateRoomId } from '../../src/room/RoomId';
import type {
  SignalingErrorReason,
  SignalingServerMessage,
} from '../../src/networking/SignalingProtocol';

export interface Peer {
  id: string;
  roomId: string | null;
  send(message: SignalingServerMessage): void;
}

export interface Room {
  id: string;
  /** null while the host is away; the room is held open for ROOM_HOST_GRACE_MS. */
  hostId: string | null;
  /** Proves ownership when a host reconnects and reclaims its room. */
  hostToken: string;
  peers: Map<string, Peer>;
  createdAt: number;
  lastActivityAt: number;
  emptySince: number | null;
  hostOfflineSince: number | null;
}

export type CreateResult =
  | { ok: true; roomId: string; hostToken: string }
  | { ok: false; reason: SignalingErrorReason };

export type JoinResult =
  | { ok: true; hostId: string; roomId: string }
  | { ok: false; reason: SignalingErrorReason };

export type ReclaimResult =
  | { ok: true; roomId: string; peers: number }
  | { ok: false; reason: SignalingErrorReason };

export interface LeaveResult {
  roomId: string;
  wasHost: boolean;
  remaining: number;
}

/**
 * Rooms live only in memory and only for as long as they are being used (spec §6).
 * There is no database and nothing here survives a restart, by design.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  get size(): number {
    return this.rooms.size;
  }

  peerCount(roomId: string): number {
    return this.rooms.get(roomId)?.peers.size ?? 0;
  }

  createRoom(host: Peer): CreateResult {
    if (this.rooms.size >= MAX_ROOMS) return { ok: false, reason: 'serverFull' };

    let roomId = generateRoomId();
    let attempts = 0;
    while (this.rooms.has(roomId) && attempts < 10) {
      roomId = generateRoomId();
      attempts++;
    }
    if (this.rooms.has(roomId)) return { ok: false, reason: 'serverFull' };

    const now = Date.now();
    const hostToken = randomBytes(24).toString('base64url');

    host.roomId = roomId;
    this.rooms.set(roomId, {
      id: roomId,
      hostId: host.id,
      hostToken,
      peers: new Map([[host.id, host]]),
      createdAt: now,
      lastActivityAt: now,
      emptySince: null,
      hostOfflineSince: null,
    });
    return { ok: true, roomId, hostToken };
  }

  /** Lets a reconnecting host take its room back, so the invite link keeps working. */
  reclaimRoom(roomId: string, token: string, host: Peer): ReclaimResult {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, reason: 'notFound' };
    if (room.hostToken !== token) return { ok: false, reason: 'invalid' };

    if (room.hostId) room.peers.delete(room.hostId);

    host.roomId = roomId;
    room.hostId = host.id;
    room.peers.set(host.id, host);
    room.hostOfflineSince = null;
    room.emptySince = null;
    room.lastActivityAt = Date.now();

    return { ok: true, roomId, peers: room.peers.size };
  }

  joinRoom(roomId: string, peer: Peer): JoinResult {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, reason: 'notFound' };
    if (!room.hostId) return { ok: false, reason: 'hostOffline' };
    if (room.peers.size >= MAX_PLAYERS) return { ok: false, reason: 'full' };

    peer.roomId = roomId;
    room.peers.set(peer.id, peer);
    room.emptySince = null;
    room.lastActivityAt = Date.now();

    // Only the host needs to know; every other peer connects through it, not to it.
    room.peers.get(room.hostId)?.send({ type: 'peerJoined', peerId: peer.id });

    return { ok: true, hostId: room.hostId, roomId };
  }

  relay(fromRoomId: string, targetId: string): Peer | null {
    const room = this.rooms.get(fromRoomId);
    if (!room) return null;

    room.lastActivityAt = Date.now();
    return room.peers.get(targetId) ?? null;
  }

  leave(peer: Peer): LeaveResult | null {
    if (!peer.roomId) return null;

    const roomId = peer.roomId;
    const room = this.rooms.get(roomId);
    peer.roomId = null;
    if (!room) return null;

    room.peers.delete(peer.id);
    const wasHost = peer.id === room.hostId;

    if (wasHost) {
      // Hold the room open: the host may have merely lost its socket, and the peer-to-peer
      // game it is running is unaffected either way.
      room.hostId = null;
      room.hostOfflineSince = Date.now();
      for (const other of room.peers.values()) {
        other.send({ type: 'peerLeft', peerId: peer.id });
      }
    } else if (room.hostId) {
      room.peers.get(room.hostId)?.send({ type: 'peerLeft', peerId: peer.id });
    }

    if (room.peers.size === 0) room.emptySince = Date.now();

    return { roomId, wasHost, remaining: room.peers.size };
  }

  /** Drops rooms that went idle, sat empty, or lost their host for good. */
  sweep(now: number = Date.now()): string[] {
    const removed: string[] = [];

    for (const room of [...this.rooms.values()]) {
      const idle = now - room.lastActivityAt > ROOM_IDLE_TTL_MS;
      const abandoned = room.emptySince !== null && now - room.emptySince > ROOM_EMPTY_TTL_MS;
      const hostGone =
        room.hostOfflineSince !== null && now - room.hostOfflineSince > ROOM_HOST_GRACE_MS;

      if (!idle && !abandoned && !hostGone) continue;

      for (const peer of room.peers.values()) peer.roomId = null;
      this.rooms.delete(room.id);
      removed.push(room.id);
    }
    return removed;
  }
}
