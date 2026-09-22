import { afterEach, describe, expect, it } from 'vitest';

import { MAX_INPUTS_PER_TICK, MAX_PLAYERS, PLAYER_SPEED } from '../src/config/constants';
import { channelFor } from '../src/networking/NetworkProtocol';
import { encode } from '../src/networking/NetworkSerializer';
import { Harness } from './harness/Harness';

let harness: Harness;

afterEach(() => harness?.destroy());

describe('host authority', () => {
  it('refuses to let a client place itself anywhere it likes', () => {
    harness = new Harness();
    const entry = harness.addClient()!;
    const playerId = entry.client.localPlayerId;
    const before = harness.host.getPlayerState(playerId)!;

    // There is no "set position" message at all, and the joystick fields are clamped.
    entry.transport.send(
      channelFor('input'),
      JSON.stringify({ type: 'input', sequence: 1, x: 999_999, y: 999_999, dt: 999 }),
    );
    harness.host.step(harness.now + 50);

    const after = harness.host.getPlayerState(playerId)!;
    const moved = Math.hypot(after.x - before.x, after.y - before.y);

    // At most one clamped step: full speed for the maximum permitted delta.
    expect(moved).toBeLessThanOrEqual(PLAYER_SPEED * 0.1 + 1e-6);
  });

  it('ignores an input that tries to name a different player', () => {
    harness = new Harness();
    const victim = harness.addClient()!;
    const attacker = harness.addClient()!;

    const victimBefore = { ...harness.host.getPlayerState(victim.client.localPlayerId)! };

    attacker.transport.send(
      channelFor('input'),
      JSON.stringify({
        type: 'input',
        sequence: 1,
        x: 1,
        y: 0,
        dt: 0.1,
        playerId: victim.client.localPlayerId,
      }),
    );
    harness.host.step(harness.now + 50);

    const victimAfter = harness.host.getPlayerState(victim.client.localPlayerId)!;
    expect(victimAfter.x).toBeCloseTo(victimBefore.x, 9);
    expect(victimAfter.y).toBeCloseTo(victimBefore.y, 9);
  });

  it('caps how far a flooding client can advance in one tick', () => {
    harness = new Harness();
    const entry = harness.addClient()!;
    const playerId = entry.client.localPlayerId;
    const before = harness.host.getPlayerState(playerId)!;

    for (let sequence = 1; sequence <= 1000; sequence++) {
      entry.transport.send(
        channelFor('input'),
        encode({ type: 'input', sequence, x: 1, y: 0, dt: 0.1 }),
      );
    }
    harness.host.step(harness.now + 50);

    const after = harness.host.getPlayerState(playerId)!;
    const moved = after.x - before.x;
    expect(moved).toBeLessThanOrEqual(PLAYER_SPEED * 0.1 * MAX_INPUTS_PER_TICK + 1e-6);
  });

  it('applies a replayed sequence number only once', () => {
    harness = new Harness();
    const entry = harness.addClient()!;
    const playerId = entry.client.localPlayerId;
    const before = harness.host.getPlayerState(playerId)!;

    const duplicate = encode({ type: 'input', sequence: 1, x: 1, y: 0, dt: 0.1 } as const);
    entry.transport.send(channelFor('input'), duplicate);
    entry.transport.send(channelFor('input'), duplicate);
    entry.transport.send(channelFor('input'), duplicate);
    harness.host.step(harness.now + 50);

    const after = harness.host.getPlayerState(playerId)!;
    expect(after.x - before.x).toBeCloseTo(PLAYER_SPEED * 0.1, 6);
  });

  it('drops malformed traffic without disturbing the simulation', () => {
    harness = new Harness();
    const entry = harness.addClient()!;
    const playerId = entry.client.localPlayerId;
    const before = { ...harness.host.getPlayerState(playerId)! };

    for (const payload of ['', 'not json', '[]', 'null', '{"type":"teleport","x":1e9}']) {
      entry.transport.send(channelFor('input'), payload);
    }
    harness.host.step(harness.now + 50);

    const after = harness.host.getPlayerState(playerId)!;
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });
});

describe('host pausing', () => {
  it('tells players already in the game when the host is backgrounded', () => {
    harness = new Harness();
    const entry = harness.addClient()!;
    expect(entry.client.isPaused).toBe(false);

    harness.host.setPaused(true, harness.now);
    expect(entry.client.isPaused).toBe(true);
  });

  it('tells a player that joins while the host is already paused', () => {
    harness = new Harness();
    harness.host.setPaused(true, harness.now);

    const entry = harness.addClient()!;
    expect(entry.client.isPaused).toBe(true);
  });

  it('stops simulating while paused', () => {
    harness = new Harness();
    const entry = harness.addClient()!;
    const before = { ...harness.host.getPlayerState(entry.client.localPlayerId)! };

    harness.host.setPaused(true, harness.now);
    harness.advance(20, () => ({ x: 1, y: 0 }));

    const after = harness.host.getPlayerState(entry.client.localPlayerId)!;
    expect(after.x).toBeCloseTo(before.x, 9);
  });

  it('resumes cleanly and stays converged', () => {
    harness = new Harness();
    harness.addClient();

    harness.host.setPaused(true, harness.now);
    harness.advance(20, () => ({ x: 1, y: 0 }));
    harness.host.setPaused(false, harness.now);
    harness.advance(20, () => ({ x: 1, y: 0 }));

    expect(harness.maxDivergence()).toBeLessThan(0.001);
  });

  it('does not drop everyone for going quiet during the pause', () => {
    harness = new Harness();
    for (let i = 0; i < 4; i++) harness.addClient();
    expect(harness.host.playerCount).toBe(5);

    harness.host.setPaused(true, harness.now);
    // Far longer than DISCONNECT_TIMEOUT_MS passes with nobody sending input.
    harness.advance(400, () => ({ x: 0, y: 0 }));
    harness.host.setPaused(false, harness.now);
    harness.advance(2, () => ({ x: 0, y: 0 }));

    expect(harness.host.playerCount).toBe(5);
  });
});

describe('room capacity', () => {
  it('accepts exactly MAX_PLAYERS including the host', () => {
    harness = new Harness();
    for (let i = 0; i < MAX_PLAYERS - 1; i++) {
      expect(harness.addClient()).not.toBeNull();
    }
    expect(harness.host.playerCount).toBe(MAX_PLAYERS);
    expect(harness.host.isFull).toBe(true);
  });

  it('rejects player 21 instead of crashing', () => {
    harness = new Harness();
    for (let i = 0; i < MAX_PLAYERS - 1; i++) harness.addClient();

    expect(harness.addClient()).toBeNull();
    expect(harness.host.playerCount).toBe(MAX_PLAYERS);
  });

  it('gives every player a distinct slot and spawn', () => {
    harness = new Harness();
    for (let i = 0; i < 9; i++) harness.addClient();

    const players = harness.clients.map(
      ({ client }) => harness.host.getPlayerState(client.localPlayerId)!,
    );
    const slots = new Set(players.map((p) => p.slot));
    expect(slots.size).toBe(players.length);

    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i]!;
        const b = players[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0);
      }
    }
  });
});

describe('disconnects', () => {
  it('frees the slot so a new player can take it', () => {
    harness = new Harness();
    for (let i = 0; i < MAX_PLAYERS - 1; i++) harness.addClient();
    expect(harness.addClient()).toBeNull();

    harness.removeClient(0);
    expect(harness.host.playerCount).toBe(MAX_PLAYERS - 1);
    expect(harness.addClient()).not.toBeNull();
  });

  it('removes the departed player from everyone else\u2019s view', () => {
    harness = new Harness();
    const leaving = harness.addClient()!;
    const staying = harness.addClient()!;

    harness.advance(3, () => ({ x: 0, y: 0 }));
    expect(staying.client.playerCount).toBe(3);

    harness.removeClient(0);
    harness.advance(1, () => ({ x: 0, y: 0 }));

    expect(harness.host.getPlayerState(leaving.client.localPlayerId)).toBeUndefined();
    expect(staying.client.playerCount).toBe(2);
  });

  it('keeps the remaining players simulating', () => {
    harness = new Harness();
    harness.addClient();
    const staying = harness.addClient()!;

    harness.removeClient(0);
    harness.advance(5, () => ({ x: 1, y: 0 }));

    expect(harness.maxDivergence()).toBeLessThan(0.001);
    expect(staying.client.localState).not.toBeNull();
  });
});
