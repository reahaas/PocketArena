import { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SignalingServer, SIGNALING_PATH } from '../server/signaling/SignalingServer';
import { MAX_PLAYERS, WS_MSG_MAX_BYTES } from '../src/config/constants';
import type {
  SignalingClientMessage,
  SignalingServerMessage,
} from '../src/networking/SignalingProtocol';

let server: SignalingServer;
let port: number;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  server = new SignalingServer({ port: 0, allowedOrigins: [] });
  port = await server.ready;
});

afterEach(async () => {
  for (const socket of sockets) socket.close();
  sockets.length = 0;
  await server.close();
});

/** A tiny promise-based client so the tests read as a conversation. */
class TestPeer {
  private readonly inbox: SignalingServerMessage[] = [];
  private waiters: (() => void)[] = [];

  private constructor(private readonly socket: WebSocket) {
    socket.on('message', (data) => {
      this.inbox.push(JSON.parse(data.toString()) as SignalingServerMessage);
      const waiters = this.waiters;
      this.waiters = [];
      for (const waiter of waiters) waiter();
    });
  }

  static async connect(url: string): Promise<TestPeer> {
    const socket = new WebSocket(url);
    sockets.push(socket);
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    return new TestPeer(socket);
  }

  send(message: SignalingClientMessage | Record<string, unknown>): void {
    this.socket.send(JSON.stringify(message));
  }

  sendRaw(payload: string): void {
    this.socket.send(payload);
  }

  async next(): Promise<SignalingServerMessage> {
    while (this.inbox.length === 0) {
      await Promise.race([
        new Promise<void>((resolve) => this.waiters.push(resolve)),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
      ]);
    }
    return this.inbox.shift()!;
  }

  async waitFor<T extends SignalingServerMessage['type']>(
    type: T,
  ): Promise<Extract<SignalingServerMessage, { type: T }>> {
    for (;;) {
      const message = await this.next();
      if (message.type === type) return message as Extract<SignalingServerMessage, { type: T }>;
    }
  }

  close(): void {
    this.socket.close();
  }
}

const url = (): string => `ws://127.0.0.1:${port}${SIGNALING_PATH}`;

describe('signaling server', () => {
  it('creates a room and hands back a usable id', async () => {
    const host = await TestPeer.connect(url());
    host.send({ type: 'createRoom' });

    const created = await host.waitFor('roomCreated');
    expect(created.roomId).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(server.roomCount).toBe(1);
  });

  it('lets a player join and tells the host about it', async () => {
    const host = await TestPeer.connect(url());
    host.send({ type: 'createRoom' });
    const created = await host.waitFor('roomCreated');

    const player = await TestPeer.connect(url());
    player.send({ type: 'joinRoom', roomId: created.roomId });

    const joined = await player.waitFor('roomJoined');
    expect(joined.hostId).toBe(created.peerId);

    const notified = await host.waitFor('peerJoined');
    expect(notified.peerId).toBe(joined.peerId);
  });

  it('rejects an unknown room', async () => {
    const player = await TestPeer.connect(url());
    player.send({ type: 'joinRoom', roomId: 'ZZZZZZ' });

    const error = await player.waitFor('roomError');
    expect(error.reason).toBe('notFound');
  });

  it('rejects player 21', async () => {
    const host = await TestPeer.connect(url());
    host.send({ type: 'createRoom' });
    const created = await host.waitFor('roomCreated');

    for (let i = 0; i < MAX_PLAYERS - 1; i++) {
      const player = await TestPeer.connect(url());
      player.send({ type: 'joinRoom', roomId: created.roomId });
      await player.waitFor('roomJoined');
    }

    const extra = await TestPeer.connect(url());
    extra.send({ type: 'joinRoom', roomId: created.roomId });

    const error = await extra.waitFor('roomError');
    expect(error.reason).toBe('full');
  });

  it('relays offers, answers and candidates between peers in a room', async () => {
    const host = await TestPeer.connect(url());
    host.send({ type: 'createRoom' });
    const created = await host.waitFor('roomCreated');

    const player = await TestPeer.connect(url());
    player.send({ type: 'joinRoom', roomId: created.roomId });
    const joined = await player.waitFor('roomJoined');
    await host.waitFor('peerJoined');

    host.send({ type: 'offer', to: joined.peerId, sdp: { type: 'offer', sdp: 'v=0' } });
    const offer = await player.waitFor('offer');
    expect(offer.from).toBe(created.peerId);
    expect(offer.sdp.sdp).toBe('v=0');

    player.send({ type: 'answer', to: created.peerId, sdp: { type: 'answer', sdp: 'v=1' } });
    expect((await host.waitFor('answer')).sdp.sdp).toBe('v=1');

    player.send({ type: 'ice', to: created.peerId, candidate: { candidate: 'x' } });
    expect((await host.waitFor('ice')).candidate).toEqual({ candidate: 'x' });
  });

  it('will not relay to a peer outside the sender\u2019s room', async () => {
    const hostA = await TestPeer.connect(url());
    hostA.send({ type: 'createRoom' });
    const roomA = await hostA.waitFor('roomCreated');

    const hostB = await TestPeer.connect(url());
    hostB.send({ type: 'createRoom' });
    const roomB = await hostB.waitFor('roomCreated');

    // Address a peer that exists, but in a different room.
    hostB.send({ type: 'offer', to: roomA.peerId, sdp: { type: 'offer', sdp: 'leak' } });
    hostA.send({ type: 'ice', to: roomB.peerId, candidate: { candidate: 'ping' } });

    const seen = await Promise.race([
      hostA.next().then(() => 'delivered'),
      new Promise<string>((resolve) => setTimeout(() => resolve('nothing'), 250)),
    ]);
    expect(seen).toBe('nothing');
  });

  it('tells everyone when the host drops, but holds the room open for it', async () => {
    const host = await TestPeer.connect(url());
    host.send({ type: 'createRoom' });
    const created = await host.waitFor('roomCreated');

    const player = await TestPeer.connect(url());
    player.send({ type: 'joinRoom', roomId: created.roomId });
    await player.waitFor('roomJoined');
    await host.waitFor('peerJoined');

    host.close();

    const left = await player.waitFor('peerLeft');
    expect(left.peerId).toBe(created.peerId);

    // The peer-to-peer game is unaffected, so the room survives for the host to come back to.
    expect(server.roomCount).toBe(1);
  });

  it('refuses new players while the host is away, without losing the room', async () => {
    const host = await TestPeer.connect(url());
    host.send({ type: 'createRoom' });
    const created = await host.waitFor('roomCreated');
    host.close();

    const latecomer = await TestPeer.connect(url());
    latecomer.send({ type: 'joinRoom', roomId: created.roomId });

    expect((await latecomer.waitFor('roomError')).reason).toBe('hostOffline');
    expect(server.roomCount).toBe(1);
  });

  it('lets a reconnecting host reclaim its room so the invite link keeps working', async () => {
    const host = await TestPeer.connect(url());
    host.send({ type: 'createRoom' });
    const created = await host.waitFor('roomCreated');
    expect(created.hostToken).toBeTruthy();

    host.close();

    const returning = await TestPeer.connect(url());
    returning.send({
      type: 'reclaimRoom',
      roomId: created.roomId,
      token: created.hostToken,
    });
    const reclaimed = await returning.waitFor('roomReclaimed');
    expect(reclaimed.roomId).toBe(created.roomId);

    // The original invite link works again.
    const player = await TestPeer.connect(url());
    player.send({ type: 'joinRoom', roomId: created.roomId });
    const joined = await player.waitFor('roomJoined');
    expect(joined.hostId).toBe(reclaimed.peerId);
  });

  it('refuses to hand a room to someone with the wrong token', async () => {
    const host = await TestPeer.connect(url());
    host.send({ type: 'createRoom' });
    const created = await host.waitFor('roomCreated');
    host.close();

    const impostor = await TestPeer.connect(url());
    impostor.send({ type: 'reclaimRoom', roomId: created.roomId, token: 'not-the-token' });

    expect((await impostor.waitFor('roomError')).reason).toBe('invalid');
  });

  it('frees a slot when a player leaves', async () => {
    const host = await TestPeer.connect(url());
    host.send({ type: 'createRoom' });
    const created = await host.waitFor('roomCreated');

    const player = await TestPeer.connect(url());
    player.send({ type: 'joinRoom', roomId: created.roomId });
    const joined = await player.waitFor('roomJoined');
    await host.waitFor('peerJoined');

    player.close();
    expect((await host.waitFor('peerLeft')).peerId).toBe(joined.peerId);
  });

  it('rejects malformed and unknown messages without dropping the connection', async () => {
    const peer = await TestPeer.connect(url());

    peer.sendRaw('not json');
    peer.send({ type: 'shutdown' });
    expect((await peer.waitFor('roomError')).reason).toBe('invalid');

    // Still usable afterwards.
    peer.send({ type: 'createRoom' });
    await peer.waitFor('roomCreated');
  });

  it('rate limits a flooding connection', async () => {
    const peer = await TestPeer.connect(url());
    for (let i = 0; i < 200; i++) peer.send({ type: 'joinRoom', roomId: 'ZZZZZZ' });

    let sawRateLimit = false;
    for (let i = 0; i < 200; i++) {
      const message = await peer.next();
      if (message.type === 'roomError' && message.reason === 'rateLimited') {
        sawRateLimit = true;
        break;
      }
    }
    expect(sawRateLimit).toBe(true);
  });

  it('closes a connection that sends an oversized frame', async () => {
    const peer = await TestPeer.connect(url());
    const closed = new Promise<boolean>((resolve) => {
      sockets[sockets.length - 1]!.once('close', () => resolve(true));
    });

    peer.sendRaw(JSON.stringify({ type: 'createRoom', pad: 'a'.repeat(WS_MSG_MAX_BYTES * 2) }));
    await expect(closed).resolves.toBe(true);
  });
});

describe('origin allowlist', () => {
  it('refuses connections from an origin that is not on the list', async () => {
    const guarded = new SignalingServer({
      port: 0,
      allowedOrigins: ['https://game.example.com'],
    });
    const guardedPort = await guarded.ready;

    const socket = new WebSocket(`ws://127.0.0.1:${guardedPort}${SIGNALING_PATH}`, {
      origin: 'https://evil.example.com',
    });

    await expect(
      new Promise((resolve, reject) => {
        socket.once('open', () => resolve('open'));
        socket.once('error', reject);
      }),
    ).rejects.toThrow();

    await guarded.close();
  });
});
