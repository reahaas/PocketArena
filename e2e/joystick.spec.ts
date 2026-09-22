import { expect, test } from '@playwright/test';

import { createGame, waitForSessionReady } from './helpers';

test.describe('the floating joystick', () => {
  test('appears where the thumb lands, not in a fixed corner', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 854, height: 384 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();

    try {
      await createGame(page);
      await waitForSessionReady(page);
      await page.getByRole('button', { name: 'Dismiss' }).click();

      const zone = (await page.locator('.joystick-zone').boundingBox())!;
      const touch = { x: zone.x + zone.width * 0.7, y: zone.y + zone.height * 0.4 };

      await page.mouse.move(touch.x, touch.y);
      await page.mouse.down();
      await page.waitForTimeout(120);

      const base = (await page.locator('.joystick-base').boundingBox())!;
      const centre = { x: base.x + base.width / 2, y: base.y + base.height / 2 };

      // The stick centres itself under the touch rather than sitting at its resting spot.
      expect(Math.abs(centre.x - touch.x)).toBeLessThan(6);
      expect(Math.abs(centre.y - touch.y)).toBeLessThan(6);

      await page.mouse.up();
    } finally {
      await context.close();
    }
  });

  test('dragging from the touch point actually moves the player', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 854, height: 384 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();

    try {
      await createGame(page);
      await waitForSessionReady(page);
      await page.getByRole('button', { name: 'Dismiss' }).click();

      const before = await page.evaluate(
        () => window.__pocketArena!.players().find((p) => p.isLocal)!.x,
      );

      const zone = (await page.locator('.joystick-zone').boundingBox())!;
      const start = { x: zone.x + zone.width * 0.5, y: zone.y + zone.height * 0.5 };

      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + 80, start.y, { steps: 6 });
      await page.waitForTimeout(900);
      await page.mouse.up();
      await page.waitForTimeout(300);

      const after = await page.evaluate(
        () => window.__pocketArena!.players().find((p) => p.isLocal)!.x,
      );
      expect(after).toBeGreaterThan(before + 30);
    } finally {
      await context.close();
    }
  });

  test('does not steal taps meant for the share overlay', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 854, height: 384 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();

    try {
      await createGame(page);
      await waitForSessionReady(page);

      const dismiss = page.getByRole('button', { name: 'Dismiss' });
      await expect(dismiss).toBeVisible();

      // The Dismiss button sits inside the joystick's catch area on a landscape phone.
      await dismiss.click();

      await expect(page.locator('.share-overlay')).toHaveClass(/hidden/);
      await expect(page.locator('.joystick-zone')).not.toHaveClass(/is-engaged/);
    } finally {
      await context.close();
    }
  });

  test('stays reachable when the page goes fullscreen', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 854, height: 384 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();

    try {
      await createGame(page);
      await waitForSessionReady(page);

      // The joystick lives in the UI layer, so fullscreen has to cover the whole document
      // rather than just the canvas or it disappears.
      const target = await page.evaluate(async () => {
        await document.documentElement.requestFullscreen().catch(() => undefined);
        return document.fullscreenElement?.tagName ?? null;
      });

      if (target === null) test.skip(true, 'Fullscreen is unavailable in this browser context');

      expect(target).toBe('HTML');
      const joystickInside = await page.evaluate(
        () => document.fullscreenElement?.contains(document.querySelector('.joystick-zone')) ?? false,
      );
      expect(joystickInside).toBe(true);
    } finally {
      await context.close();
    }
  });
});
