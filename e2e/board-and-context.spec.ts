import { expect, test } from '@playwright/test';

import { ARENA_HEIGHT, ARENA_WIDTH, PLAYER_RADIUS } from '../src/config/constants';
import { createGame, holdKey, readLocalPlayer, waitForSessionReady } from './helpers';

/**
 * `crypto.randomUUID` only exists in a secure context. A phone opening the dev server over
 * http://<lan-ip> does not get one, which used to strand the host on "Creating game...".
 */
test.describe('insecure context (plain HTTP on a LAN address)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      delete (Crypto.prototype as { randomUUID?: unknown }).randomUUID;
    });
  });

  test('a host can still create a game without crypto.randomUUID', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    const inviteUrl = await createGame(page);

    expect(inviteUrl).toMatch(/\/join\/[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(errors).toEqual([]);
    await waitForSessionReady(page);
  });

  test('the generated player id is still a usable v4 uuid', async ({ page }) => {
    await createGame(page);
    await waitForSessionReady(page);

    const id = await page.evaluate(() => window.__pocketArena?.localPlayerId() ?? '');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

test.describe('the board always fits the screen', () => {
  test('the whole arena is visible on a landscape phone', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await createGame(page);
    await waitForSessionReady(page);

    const metrics = await page.evaluate(() => {
      const root = document.getElementById('game-root')!.getBoundingClientRect();
      const canvas = document.querySelector('#game-root canvas')!.getBoundingClientRect();
      return {
        root: { w: root.width, h: root.height },
        canvas: { w: canvas.width, h: canvas.height },
        layout: { w: window.innerWidth, h: window.innerHeight },
      };
    });

    // The board container must cover the whole viewport.
    expect(metrics.root.w).toBeCloseTo(metrics.layout.w, 0);
    expect(metrics.root.h).toBeCloseTo(metrics.layout.h, 0);

    // The board keeps its aspect ratio and fits inside without cropping.
    expect(metrics.canvas.w / metrics.canvas.h).toBeCloseTo(ARENA_WIDTH / ARENA_HEIGHT, 1);
    expect(metrics.canvas.w).toBeLessThanOrEqual(metrics.root.w + 1);
    expect(metrics.canvas.h).toBeLessThanOrEqual(metrics.root.h + 1);

    // ...and it actually fills the constraining dimension rather than sitting small in the middle.
    const scale = Math.min(metrics.root.w / ARENA_WIDTH, metrics.root.h / ARENA_HEIGHT);
    expect(metrics.canvas.w).toBeCloseTo(ARENA_WIDTH * scale, 0);
    expect(metrics.canvas.h).toBeCloseTo(ARENA_HEIGHT * scale, 0);
  });

  test('the board fills a real landscape phone viewport', async ({ browser }) => {
    // Mobile emulation matters here: isMobile changes how the visual viewport is reported.
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
      await page.waitForTimeout(500);

      const metrics = await page.evaluate(() => {
        const root = document.getElementById('game-root')!.getBoundingClientRect();
        const canvas = document.querySelector('#game-root canvas')!.getBoundingClientRect();
        return {
          root: { w: root.width, h: root.height },
          canvas: { w: canvas.width, h: canvas.height },
        };
      });

      const scale = Math.min(metrics.root.w / ARENA_WIDTH, metrics.root.h / ARENA_HEIGHT);
      expect(metrics.canvas.w).toBeCloseTo(ARENA_WIDTH * scale, 0);
      expect(metrics.canvas.h).toBeCloseTo(ARENA_HEIGHT * scale, 0);
    } finally {
      await context.close();
    }
  });

  test('the board re-fits after rotating from portrait to landscape', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 384, height: 854 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();

    try {
      await createGame(page);
      await waitForSessionReady(page);
      await page.waitForTimeout(400);

      // Rotate. The board must grow to the new width, not stay at the portrait size.
      await page.setViewportSize({ width: 854, height: 384 });
      await page.waitForTimeout(1200);

      const metrics = await page.evaluate(() => {
        const root = document.getElementById('game-root')!.getBoundingClientRect();
        const canvas = document.querySelector('#game-root canvas')!.getBoundingClientRect();
        return {
          root: { w: root.width, h: root.height },
          canvas: { w: canvas.width, h: canvas.height },
          viewport: { w: window.visualViewport?.width ?? window.innerWidth, h: window.visualViewport?.height ?? window.innerHeight },
        };
      });

      // The container must track the rotated viewport...
      expect(metrics.root.w).toBeCloseTo(metrics.viewport.w, 0);
      expect(metrics.root.h).toBeCloseTo(metrics.viewport.h, 0);

      // ...and the board must fill the constraining dimension of it.
      const scale = Math.min(metrics.root.w / ARENA_WIDTH, metrics.root.h / ARENA_HEIGHT);
      expect(metrics.canvas.w).toBeCloseTo(ARENA_WIDTH * scale, 0);
      expect(metrics.canvas.h).toBeCloseTo(ARENA_HEIGHT * scale, 0);

      // Guards against the reported bug specifically: the board kept the portrait width.
      expect(metrics.canvas.w).toBeGreaterThan(500);
    } finally {
      await context.close();
    }
  });

  test('a stale container size is corrected instead of shrinking the board', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 420 });
    await createGame(page);
    await waitForSessionReady(page);
    await page.waitForTimeout(400);

    // Reproduce the reported device behaviour: the container is left holding a smaller,
    // pre-rotation box while the viewport is actually much wider.
    await page.evaluate(() => {
      const root = document.getElementById('game-root')!;
      root.style.width = '384px';
      root.style.height = '215px';
      window.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(1200);

    const metrics = await page.evaluate(() => {
      const root = document.getElementById('game-root')!.getBoundingClientRect();
      const canvas = document.querySelector('#game-root canvas')!.getBoundingClientRect();
      return { root: { w: root.width, h: root.height }, canvas: { w: canvas.width, h: canvas.height } };
    });

    expect(metrics.root.w).toBeCloseTo(900, 0);
    expect(metrics.root.h).toBeCloseTo(420, 0);

    const scale = Math.min(900 / ARENA_WIDTH, 420 / ARENA_HEIGHT);
    expect(metrics.canvas.w).toBeCloseTo(ARENA_WIDTH * scale, 0);
    expect(metrics.canvas.h).toBeCloseTo(ARENA_HEIGHT * scale, 0);
  });

  test('the camera never scrolls, so the world stays put while the player moves', async ({
    page,
  }) => {
    await createGame(page);
    await waitForSessionReady(page);

    const scrollBefore = await page.evaluate(() => window.__pocketArena?.cameraScroll());
    await holdKey(page, 'ArrowRight', 900);
    const scrollAfter = await page.evaluate(() => window.__pocketArena?.cameraScroll());

    expect(scrollBefore).toEqual({ x: 0, y: 0 });
    expect(scrollAfter).toEqual({ x: 0, y: 0 });
  });

  test('a player cannot leave the board', async ({ page }) => {
    await createGame(page);
    await waitForSessionReady(page);

    // Drive hard into the bottom-right corner for longer than it takes to cross the arena.
    await holdKey(page, 'ArrowRight', 2500);
    await holdKey(page, 'ArrowDown', 2500);

    const player = await readLocalPlayer(page);
    expect(player.x).toBeLessThanOrEqual(ARENA_WIDTH - PLAYER_RADIUS + 0.5);
    expect(player.y).toBeLessThanOrEqual(ARENA_HEIGHT - PLAYER_RADIUS + 0.5);

    await holdKey(page, 'ArrowLeft', 2500);
    await holdKey(page, 'ArrowUp', 2500);

    const corner = await readLocalPlayer(page);
    expect(corner.x).toBeGreaterThanOrEqual(PLAYER_RADIUS - 0.5);
    expect(corner.y).toBeGreaterThanOrEqual(PLAYER_RADIUS - 0.5);
  });
});
