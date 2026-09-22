import { expect, test } from '@playwright/test';

import { createGame, joinGame, waitForPlayerCount, waitForSessionReady } from './helpers';

test.describe('recovering from a dropped connection', () => {
  test('the indicator turns into a rejoin button and rejoining works', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();

    try {
      const inviteUrl = await createGame(host);
      await waitForSessionReady(host);
      await joinGame(player, inviteUrl);
      await waitForPlayerCount(player, 2);

      const indicator = player.locator('.connection-indicator');
      await expect(indicator).toHaveText(/Connected/);
      await expect(indicator).not.toHaveClass(/is-actionable/);

      // Kill the peer connection the way a WiFi blip would, leaving the room intact.
      await player.evaluate(() => window.__pocketArena?.dropConnection?.());

      await expect(indicator).toHaveClass(/is-actionable/, { timeout: 15_000 });
      await expect(indicator).toHaveText(/tap to rejoin/);
      await expect(indicator).toHaveAttribute('role', 'button');

      await indicator.click();

      await waitForSessionReady(player);
      await waitForPlayerCount(player, 2);
      await expect(player.locator('.connection-indicator')).toHaveText(/Connected/);
    } finally {
      await playerContext.close();
      await hostContext.close();
    }
  });

  test('a game that no longer exists offers no false hope', async ({ page }) => {
    await page.goto('/join/ZZZZZZ?debug=1');
    await page.getByRole('button', { name: 'JOIN GAME' }).click();

    await expect(page.getByText('Game not found')).toBeVisible();
    // Retrying a deleted room can never succeed, so only the way back is offered.
    await expect(page.getByRole('button', { name: 'BACK TO START' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'TRY AGAIN' })).toHaveCount(0);
  });
});
