import { expect, test } from '@playwright/test';

import { createGame, readDebugOverlay, waitForSessionReady } from './helpers';

test.describe('entry experience', () => {
  test('the home screen offers exactly one action', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'POCKET ARENA' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'CREATE GAME' })).toBeVisible();

    // No lobby, no room code entry, no name prompt (spec §2, §45).
    await expect(page.locator('input')).toHaveCount(0);
  });

  test('creating a game yields a shareable link and drops the host straight into play', async ({
    page,
  }) => {
    const inviteUrl = await createGame(page);

    expect(inviteUrl).toMatch(/\/join\/[0-9A-HJKMNP-TV-Z]{6}$/);
    await expect(page.locator('.share-count')).toHaveText('Players: 1 / 20');

    // The arena is already live behind the share overlay.
    await expect(page.locator('canvas')).toBeVisible();
    await waitForSessionReady(page);
  });

  test('the invite link deep-loads directly, as it must from a messaging app', async ({
    page,
    context,
  }) => {
    const host = page;
    const inviteUrl = await createGame(host);

    const guest = await context.newPage();
    await guest.goto(inviteUrl);

    // Served by the SPA fallback, not a 404.
    await expect(guest.getByRole('button', { name: 'JOIN GAME' })).toBeVisible();
    await guest.close();
  });

  test('an unknown game id is refused clearly', async ({ page }) => {
    await page.goto('/join/ZZZZZZ');
    await page.getByRole('button', { name: 'JOIN GAME' }).click();

    await expect(page.getByRole('heading', { name: 'Game not found' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'BACK TO START' })).toBeVisible();
  });

  test('players are never shown networking jargon', async ({ page }) => {
    await createGame(page);

    // The debug overlay is the one place technical terms are allowed, so exclude it.
    const visibleText = await page.evaluate(() => {
      const root = document.getElementById('ui-root');
      const clone = root?.cloneNode(true) as HTMLElement | undefined;
      clone?.querySelector('.debug-overlay')?.remove();
      return clone?.innerText ?? '';
    });

    for (const term of ['WebRTC', 'ICE', 'STUN', 'SDP', 'DataChannel', 'signaling']) {
      expect(visibleText).not.toContain(term);
    }
  });

  test('the debug overlay is opt-in', async ({ page, context }) => {
    await createGame(page);
    await expect(page.locator('.debug-overlay')).toBeVisible();

    const plain = await context.newPage();
    await plain.goto('/');
    await plain.getByRole('button', { name: 'CREATE GAME' }).click();
    await expect(plain.locator('.share-link')).toBeVisible();

    await expect(plain.locator('.debug-overlay')).toHaveCount(0);
    expect(await plain.evaluate(() => window.__pocketArena === undefined)).toBe(true);
    await plain.close();
  });

  test('the host reports a running simulation', async ({ page }) => {
    await createGame(page);
    await waitForSessionReady(page);
    await page.waitForTimeout(1500);

    const stats = await readDebugOverlay(page);
    expect(stats.role).toBe('host');
    expect(Number(stats.tick)).toBeGreaterThan(0);
  });
});
