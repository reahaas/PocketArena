import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

import {
  WS_HEARTBEAT_MS,
  WS_MSGS_PER_SEC,
  WS_MSG_MAX_BYTES,
} from '../../src/config/constants';
import {
  parseSignalingClientMessage,
  type SignalingServerMessage,
} from '../../src/networking/SignalingProtocol';
import { createStaticServer } from '../staticServer';
import { RoomManager, type Peer } from './RoomManager';
import { log } from './log';

interface Connection extends Peer {
  socket: WebSocket;
  alive: boolean;
  tokens: number;
  lastRefill: number;
}

export interface SignalingServerOptions {
  port: number;
  allowedOrigins: string[];
  /** Serves the built client on the same port when provided. */
  staticDir?: string | null;
}

/** Gameplay never touches this path; it exists only to introduce peers. */
export const SIGNALING_PATH = '/ws';

export class SignalingServer {
  private readonly http: Server;
  private readonly wss: WebSocketServer;
  private readonly rooms = new RoomManager();
  private readonly connections = new Set<Connection>();
  private readonly heartbeat: NodeJS.Timeout;
  private readonly sweeper: NodeJS.Timeout;

  /** Resolves with the actually bound port, so callers may pass port 0. */
  readonly ready: Promise<number>;

  constructor(private readonly options: SignalingServerOptions) {
    this.http = createStaticServer(options.staticDir ?? null);
    this.wss = new WebSocketServer({
      server: this.http,
      path: SIGNALING_PATH,
      maxPayload: WS_MSG_MAX_BYTES,
      verifyClient: (info: { origin: string; secure: boolean; req: IncomingMessage }) =>
        this.isOriginAllowed(info.origin),
    });

    this.ready = new Promise((resolve) => {
      this.http.listen(options.port, () => {
        const address = this.http.address();
        resolve(typeof address === 'object' && address ? address.port : options.port);
      });
    });

    this.wss.on('connection', (socket) => this.onConnection(socket));

    this.heartbeat = setInterval(() => this.pruneDeadConnections(), WS_HEARTBEAT_MS);
    this.sweeper = setInterval(() => {
      const removed = this.rooms.sweep();
      if (removed.length > 0) {
        log.info('rooms.swept', { removed: removed.join(','), rooms: this.rooms.size });
      }
    }, WS_HEARTBEAT_MS);
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  /** Drops every signaling socket while keeping rooms and the process alive. */
  dropAllConnections(): void {
    for (const connection of [...this.connections]) {
      connection.socket.terminate();
      this.onClose(connection);
    }
  }

  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    clearInterval(this.sweeper);
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  private isOriginAllowed(origin: string | undefined): boolean {
    // An empty allowlist means "development, allow anything".
    if (this.options.allowedOrigins.length === 0) return true;
    if (!origin) return false;
    return this.options.allowedOrigins.includes(origin);
  }

  private onConnection(socket: WebSocket): void {
    const connection: Connection = {
      id: randomUUID(),
      roomId: null,
      socket,
      alive: true,
      tokens: WS_MSGS_PER_SEC,
      lastRefill: Date.now(),
      send: (message) => this.send(socket, message),
    };
    this.connections.add(connection);

    socket.on('pong', () => {
      connection.alive = true;
    });
    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      this.onMessage(connection, data.toString());
    });
    socket.on('close', () => this.onClose(connection));
    socket.on('error', () => socket.terminate());
  }

  private onMessage(connection: Connection, raw: string): void {
    if (raw.length > WS_MSG_MAX_BYTES) {
      connection.send({ type: 'roomError', reason: 'invalid' });
      return;
    }
    if (!this.consumeToken(connection)) {
      connection.send({ type: 'roomError', reason: 'rateLimited' });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    const message = parseSignalingClientMessage(parsed);
    if (!message) {
      connection.send({ type: 'roomError', reason: 'invalid' });
      return;
    }

    switch (message.type) {
      case 'createRoom': {
        if (connection.roomId) return;
        const result = this.rooms.createRoom(connection);
        if (!result.ok) {
          log.warn('room.create.rejected', { reason: result.reason, peer: connection.id });
          connection.send({ type: 'roomError', reason: result.reason });
          return;
        }
        log.info('room.created', { room: result.roomId, rooms: this.rooms.size });
        connection.send({
          type: 'roomCreated',
          roomId: result.roomId,
          peerId: connection.id,
          hostToken: result.hostToken,
        });
        return;
      }

      case 'reclaimRoom': {
        if (connection.roomId) return;
        const result = this.rooms.reclaimRoom(message.roomId, message.token, connection);
        if (!result.ok) {
          log.warn('room.reclaim.rejected', { room: message.roomId, reason: result.reason });
          connection.send({ type: 'roomError', reason: result.reason });
          return;
        }
        log.info('room.reclaimed', { room: result.roomId, peers: result.peers });
        connection.send({ type: 'roomReclaimed', roomId: result.roomId, peerId: connection.id });
        return;
      }

      case 'joinRoom': {
        if (connection.roomId) return;
        const result = this.rooms.joinRoom(message.roomId, connection);
        if (!result.ok) {
          log.info('room.join.rejected', { room: message.roomId, reason: result.reason });
          connection.send({ type: 'roomError', reason: result.reason });
          return;
        }
        log.info('room.joined', {
          room: result.roomId,
          peers: this.rooms.peerCount(result.roomId),
        });
        connection.send({
          type: 'roomJoined',
          roomId: result.roomId,
          peerId: connection.id,
          hostId: result.hostId,
        });
        return;
      }

      case 'offer':
      case 'answer': {
        const target = this.resolveTarget(connection, message.to);
        target?.send({ type: message.type, from: connection.id, sdp: message.sdp });
        return;
      }

      case 'ice': {
        const target = this.resolveTarget(connection, message.to);
        target?.send({ type: 'ice', from: connection.id, candidate: message.candidate });
        return;
      }
    }
  }

  /** Peers may only address others inside their own room. */
  private resolveTarget(connection: Connection, targetId: string): Peer | null {
    if (!connection.roomId) return null;
    return this.rooms.relay(connection.roomId, targetId);
  }

  private consumeToken(connection: Connection): boolean {
    const now = Date.now();
    const elapsedSeconds = (now - connection.lastRefill) / 1000;
    connection.lastRefill = now;
    connection.tokens = Math.min(
      WS_MSGS_PER_SEC,
      connection.tokens + elapsedSeconds * WS_MSGS_PER_SEC,
    );

    if (connection.tokens < 1) return false;
    connection.tokens -= 1;
    return true;
  }

  private onClose(connection: Connection): void {
    const left = this.rooms.leave(connection);
    this.connections.delete(connection);

    if (left) {
      log.info(left.wasHost ? 'room.host.offline' : 'room.left', {
        room: left.roomId,
        peers: left.remaining,
      });
    }
  }

  private pruneDeadConnections(): void {
    for (const connection of this.connections) {
      if (!connection.alive) {
        log.info('connection.timeout', { peer: connection.id });
        connection.socket.terminate();
        this.onClose(connection);
        continue;
      }
      connection.alive = false;
      connection.socket.ping();
    }
  }

  private send(socket: WebSocket, message: SignalingServerMessage): void {
    if (socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify(message));
  }
}
