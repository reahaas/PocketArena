import { expect, test, type WebSocketRoute } from '@playwright/test';

import {
  createGame,
  holdKey,
  joinGame,
  localPlayerId,
  readLocalPlayer,
  readRemotePlayer,
  waitForPlayerCount,
  waitForSessionReady,
} from './helpers';

const SIGNALING = /:8787/;

/**
 * Signaling exists only to introduce peers. Once the data channels are open the game is a
 * direct peer-to-peer link, so losing the service must not interrupt play (spec §6).
 */
test.describe('independence from the signaling service', () => {
  test('play continues after signaling disappears for both peers', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();

    let hostSocket: WebSocketRoute | undefined;
    let playerSocket: WebSocketRoute | undefined;

    await host.routeWebSocket(SIGNALING, (ws) => {
      hostSocket = ws;
      ws.connectToServer();
    });
    await player.routeWebSocket(SIGNALING, (ws) => {
      playerSocket = ws;
      ws.connectToServer();
    });

    try {
      const inviteUrl = await createGame(host);
      await waitForSessionReady(host);
      await joinGame(player, inviteUrl);
      await waitForPlayerCount(host, 2);
      await waitForPlayerCount(player, 2);

      const hostId = await localPlayerId(host);
      const playerId = await localPlayerId(player);

      // Pull the rug: the signaling service is now gone for everyone.
      expect(hostSocket).toBeDefined();
      expect(playerSocket).toBeDefined();
      await hostSocket!.close();
      await playerSocket!.close();
      await host.waitForTimeout(1000);

      // The host moves; the guest must still see it.
      const hostSeenBefore = await readRemotePlayer(player, hostId);
      await host.bringToFront();
      await holdKey(host, 'ArrowRight', 900);
      const hostSeenAfter = await readRemotePlayer(player, hostId);

      expect(hostSeenBefore).toBeDefined();
      expect(hostSeenAfter!.x).toBeGreaterThan(hostSeenBefore!.x + 20);

      // The guest moves; the host must still see it, and still be authoritative over it.
      const guestSeenBefore = await readRemotePlayer(host, playerId);
      await player.bringToFront();
      await holdKey(player, 'ArrowDown', 900);
      const guestSeenAfter = await readRemotePlayer(host, playerId);
      const guestLocal = await readLocalPlayer(player);

      expect(guestSeenAfter!.y).toBeGreaterThan(guestSeenBefore!.y + 20);
      expect(guestSeenAfter!.y).toBeCloseTo(guestLocal.y, -1);

      // Both still consider each other present.
      await waitForPlayerCount(host, 2);
      await waitForPlayerCount(player, 2);
    } finally {
      await playerContext.close();
      await hostContext.close();
    }
  });

  test('a new player cannot join once signaling is gone, but the existing game plays on', async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const host = await hostContext.newPage();

    let hostSocket: WebSocketRoute | undefined;
    await host.routeWebSocket(SIGNALING, (ws) => {
      hostSocket = ws;
      ws.connectToServer();
    });

    const playerContext = await browser.newContext();
    const player = await playerContext.newPage();

    try {
      const inviteUrl = await createGame(host);
      await joinGame(player, inviteUrl);
      await waitForPlayerCount(host, 2);

      await hostSocket!.close();
      await host.waitForTimeout(500);

      // The running game is unaffected...
      await host.bringToFront();
      await holdKey(host, 'ArrowRight', 700);
      await waitForPlayerCount(host, 2);
      await waitForPlayerCount(player, 2);

      // ...but the host can no longer be introduced to anyone new.
      const latecomerContext = await browser.newContext();
      const latecomer = await latecomerContext.newPage();
      await latecomer.goto(`${inviteUrl}?debug=1`);
      await latecomer.getByRole('button', { name: 'JOIN GAME' }).click();

      await expect(latecomer.locator('.panel')).toBeVisible();
      await expect(host.locator('.debug-overlay')).toContainText('players   2');
      await latecomerContext.close();
    } finally {
      await playerContext.close();
      await hostContext.close();
    }
  });
});
