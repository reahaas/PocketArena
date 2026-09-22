import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SignalingServer, SIGNALING_PATH } from '../server/signaling/SignalingServer';
import { SignalingClient, SignalingError } from '../src/networking/SignalingClient';
import type { SignalingServerMessage } from '../src/networking/SignalingProtocol';

let server: SignalingServer;
let url: string;
const clients: SignalingClient[] = [];

beforeEach(async () => {
  server = new SignalingServer({ port: 0, allowedOrigins: [] });
  url = `ws://127.0.0.1:${await server.ready}${SIGNALING_PATH}`;
});

afterEach(async () => {
  for (const client of clients) client.close();
  clients.length = 0;
  await server.close();
});

async function connect(): Promise<SignalingClient> {
  const client = new SignalingClient();
  clients.push(client);
  await client.connect(url);
  return client;
}

const settle = (ms = 150): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('SignalingClient', () => {
  it('reclaims its room after losing the socket, so the invite link keeps working', async () => {
    const host = await connect();
    const { roomId, hostToken, peerId } = await host.createRoom();

    let reclaimedAs = '';
    host.enableAutoReconnect(async () => {
      ({ peerId: reclaimedAs } = await host.reclaimRoom(roomId, hostToken));
    });

    // A dropped socket, with the server and the room both still very much alive.
    server.dropAllConnections();
    expect(server.roomCount).toBe(1);

    await settle(2_500);
    expect(reclaimedAs).not.toBe('');
    expect(reclaimedAs).not.toBe(peerId);

    // The original link still works, and points at the reconnected host.
    const guest = await connect();
    const joined = await guest.joinRoom(roomId);
    expect(joined.hostId).toBe(reclaimedAs);
  });

  it('creates and joins a room', async () => {
    const host = await connect();
    const { roomId, peerId } = await host.createRoom();

    const guest = await connect();
    const joined = await guest.joinRoom(roomId);

    expect(joined.roomId).toBe(roomId);
    expect(joined.hostId).toBe(peerId);
  });

  it('surfaces a missing room as a typed error', async () => {
    const guest = await connect();
    await expect(guest.joinRoom('ZZZZZZ')).rejects.toBeInstanceOf(SignalingError);
    await expect(guest.joinRoom('ZZZZZZ')).rejects.toMatchObject({ reason: 'notFound' });
  });

  /**
   * Regression: the server notifies the host the instant joinRoom succeeds, so the host's
   * offer could arrive before the joiner had wired up its handler. The message used to be
   * dropped and the joiner would sit until the welcome timeout.
   */
  it('does not lose messages that arrive before a handler is registered', async () => {
    const host = await connect();
    const { roomId } = await host.createRoom();

    const guest = await connect();
    await guest.joinRoom(roomId);

    // The host has not subscribed yet; peerJoined is already in flight.
    await settle();

    const seen: SignalingServerMessage[] = [];
    host.onMessage((message) => seen.push(message));

    expect(seen.map((m) => m.type)).toContain('peerJoined');
  });

  it('replays a relayed offer that beat the subscription', async () => {
    const host = await connect();
    const { roomId, peerId: hostId } = await host.createRoom();

    const guest = await connect();
    const { peerId: guestId } = await guest.joinRoom(roomId);

    host.onMessage(() => {});
    host.send({ type: 'offer', to: guestId, sdp: { type: 'offer', sdp: 'v=0' } });

    // Guest subscribes late, exactly as App.joinGame used to.
    await settle();

    const seen: SignalingServerMessage[] = [];
    guest.onMessage((message) => seen.push(message));

    const offer = seen.find((m) => m.type === 'offer');
    expect(offer).toBeDefined();
    expect(offer).toMatchObject({ from: hostId });
  });

  it('delivers to a subscriber immediately once one exists', async () => {
    const host = await connect();
    const { roomId } = await host.createRoom();

    const seen: SignalingServerMessage[] = [];
    host.onMessage((message) => seen.push(message));

    const guest = await connect();
    await guest.joinRoom(roomId);
    await settle();

    expect(seen.map((m) => m.type)).toContain('peerJoined');
  });

  it('reports the host leaving', async () => {
    const host = await connect();
    const { roomId, peerId: hostId } = await host.createRoom();

    const guest = await connect();
    await guest.joinRoom(roomId);

    const seen: SignalingServerMessage[] = [];
    guest.onMessage((message) => seen.push(message));

    host.close();
    await settle(300);

    expect(seen).toContainEqual({ type: 'peerLeft', peerId: hostId });
  });
});
