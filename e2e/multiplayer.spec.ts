import { expect, test, type Page } from '@playwright/test';

import {
  createGame,
  holdKey,
  joinGame,
  localPlayerId,
  openInvite,
  readLocalPlayer,
  readPlayers,
  readRemotePlayer,
  waitForPlayerCount,
  waitForSessionReady,
} from './helpers';

/**
 * These are the tests that could not be run in the embedded browser: two real pages, a real
 * WebRTC connection between them, and movement crossing the wire in both directions.
 */
test.describe('two players over real WebRTC', () => {
  let host: Page;
  let guest: Page;

  test.beforeEach(async ({ context }) => {
    host = await context.newPage();
    guest = await context.newPage();

    const inviteUrl = await createGame(host);
    await joinGame(guest, inviteUrl);

    await waitForPlayerCount(host, 2);
    await waitForPlayerCount(guest, 2);
  });

  test.afterEach(async () => {
    await guest.close().catch(() => {});
    await host.close().catch(() => {});
  });

  test('both sides see each other exactly once', async () => {
    const hostPlayers = await readPlayers(host);
    const guestPlayers = await readPlayers(guest);

    expect(hostPlayers).toHaveLength(2);
    expect(guestPlayers).toHaveLength(2);

    expect(hostPlayers.filter((p) => p.isLocal)).toHaveLength(1);
    expect(guestPlayers.filter((p) => p.isLocal)).toHaveLength(1);

    // Same two identities on both sides.
    const hostIds = hostPlayers.map((p) => p.id).sort();
    const guestIds = guestPlayers.map((p) => p.id).sort();
    expect(hostIds).toEqual(guestIds);
  });

  test('nobody spawns on top of anyone else, or at the origin', async () => {
    const [a, b] = await readPlayers(host);

    expect(a!.x).toBeGreaterThan(0);
    expect(a!.y).toBeGreaterThan(0);
    expect(Math.hypot(a!.x - b!.x, a!.y - b!.y)).toBeGreaterThan(48);
  });

  test('the guest sees the host move', async () => {
    const hostId = await localPlayerId(host);
    const before = await readRemotePlayer(guest, hostId);

    await host.bringToFront();
    await holdKey(host, 'ArrowRight', 1000);

    const after = await readRemotePlayer(guest, hostId);
    expect(after!.x).toBeGreaterThan(before!.x + 50);
  });

  test('the host sees the guest move', async () => {
    const guestId = await localPlayerId(guest);
    const before = await readRemotePlayer(host, guestId);

    await guest.bringToFront();
    await holdKey(guest, 'ArrowDown', 1000);

    const after = await readRemotePlayer(host, guestId);
    expect(after!.y).toBeGreaterThan(before!.y + 50);
  });

  test('the guest\u2019s own movement is predicted locally and agreed by the host', async () => {
    const guestId = await localPlayerId(guest);

    await guest.bringToFront();
    const before = await readLocalPlayer(guest);
    await holdKey(guest, 'ArrowRight', 1000);

    const predicted = await readLocalPlayer(guest);
    expect(predicted.x).toBeGreaterThan(before.x + 50);

    // The host is authoritative; its position for the guest must agree closely.
    const authoritative = await readRemotePlayer(host, guestId);
    expect(Math.abs(authoritative!.x - predicted.x)).toBeLessThan(120);
  });

  test('a player cannot leave the arena', async () => {
    await guest.bringToFront();
    await holdKey(guest, 'ArrowLeft', 4000);

    const local = await readLocalPlayer(guest);
    expect(local.x).toBeGreaterThanOrEqual(20);
  });

  test('when the guest leaves, the host frees the slot and keeps playing', async () => {
    const guestId = await localPlayerId(guest);
    await guest.close();

    await waitForPlayerCount(host, 1);
    expect(await readRemotePlayer(host, guestId)).toBeUndefined();

    // The host is still simulating.
    await host.bringToFront();
    const before = await readLocalPlayer(host);
    await holdKey(host, 'ArrowRight', 800);
    expect((await readLocalPlayer(host)).x).toBeGreaterThan(before.x);
  });

  test('when the host leaves, the guest is told plainly', async () => {
    await host.close();

    await expect(guest.getByRole('heading', { name: 'Host disconnected' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(guest.getByRole('button', { name: 'BACK TO START' })).toBeVisible();
  });
});

test.describe('joining a game already in progress', () => {
  test('a latecomer arrives at a clean spawn and is visible to everyone', async ({ context }) => {
    const host = await context.newPage();
    const first = await context.newPage();

    const inviteUrl = await createGame(host);
    await joinGame(first, inviteUrl);
    await waitForPlayerCount(host, 2);

    // Let the game run so the newcomer is genuinely joining mid-match.
    await host.bringToFront();
    await holdKey(host, 'ArrowRight', 1200);

    const latecomer = await context.newPage();
    await joinGame(latecomer, inviteUrl);

    const local = await readLocalPlayer(latecomer);
    expect(local.x).toBeGreaterThan(0);
    expect(local.y).toBeGreaterThan(0);

    await waitForPlayerCount(latecomer, 3);
    await waitForPlayerCount(host, 3);
    await waitForPlayerCount(first, 3);

    await latecomer.close();
    await first.close();
    await host.close();
  });
});

test.describe('a full room', () => {
  test('rejects the 21st player instead of degrading', async ({ context }) => {
    const host = await context.newPage();

    // 1 host + 19 bots fills every slot.
    const inviteUrl = await createGame(host, 'bots=19');
    await waitForSessionReady(host);
    await waitForPlayerCount(host, 20);
    await expect(host.locator('.share-count')).toHaveText('Players: 20 / 20');

    const rejected = await context.newPage();
    await openInvite(rejected, inviteUrl);

    await expect(rejected.getByRole('heading', { name: 'Game is full' })).toBeVisible();

    await rejected.close();
    await host.close();
  });
});
