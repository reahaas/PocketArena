import { expect, type Page } from '@playwright/test';

import type { RenderPlayer } from '../src/game/RenderPlayer';

export const DEBUG_QUERY = 'debug=1';

function withDebug(url: string, extra = ''): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${DEBUG_QUERY}${extra ? `&${extra}` : ''}`;
}

/** Creates a game as the host and returns the invite URL shown in the share overlay. */
export async function createGame(page: Page, extraQuery = ''): Promise<string> {
  await page.goto(withDebug('/', extraQuery));
  await page.getByRole('button', { name: 'CREATE GAME' }).click();

  const link = page.locator('.share-link');
  await expect(link).toBeVisible();

  const inviteUrl = (await link.textContent())?.trim();
  if (!inviteUrl) throw new Error('Share overlay did not render an invite URL');
  return inviteUrl;
}

/** Opens an invite link and presses Join. Does not wait for the game to start. */
export async function openInvite(page: Page, inviteUrl: string): Promise<void> {
  await page.goto(withDebug(inviteUrl));
  await page.getByRole('button', { name: 'JOIN GAME' }).click();
}

export async function joinGame(page: Page, inviteUrl: string): Promise<void> {
  await openInvite(page, inviteUrl);
  await waitForSessionReady(page);
}

/** Resolves once the debug session hook exists, i.e. the game loop is actually running. */
export async function waitForSessionReady(page: Page): Promise<void> {
  // Only the foreground page is guaranteed a steady animation frame in headless Chromium.
  await page.bringToFront().catch(() => undefined);

  try {
    await page.waitForFunction(() => (window.__pocketArena?.players().length ?? 0) > 0, null, {
      timeout: 30_000,
    });
  } catch (error) {
    // A bare timeout hides which screen the player actually ended up on.
    const screen = await page
      .evaluate(() => document.getElementById('ui-root')?.innerText ?? '(empty)')
      .catch(() => '(unreadable)');
    throw new Error(`Session never started. Page is showing:\n${screen}\n\nOriginal: ${String(error)}`);
  }
}

export async function readPlayers(page: Page): Promise<RenderPlayer[]> {
  return page.evaluate(() => window.__pocketArena?.players() ?? []);
}

export async function localPlayerId(page: Page): Promise<string> {
  return page.evaluate(() => window.__pocketArena?.localPlayerId() ?? '');
}

export async function waitForPlayerCount(page: Page, count: number): Promise<void> {
  // With several pages open only the foreground one is guaranteed a steady animation frame,
  // so make this page current before waiting on state its loop has to produce.
  await page.bringToFront().catch(() => undefined);

  try {
    await page.waitForFunction(
      (expected) => (window.__pocketArena?.players().length ?? 0) === expected,
      count,
      { timeout: 30_000 },
    );
  } catch (error) {
    const seen = await page
      .evaluate(() => window.__pocketArena?.players().length ?? -1)
      .catch(() => -1);
    const screen = await page
      .evaluate(() => document.getElementById('ui-root')?.innerText ?? '(empty)')
      .catch(() => '(unreadable)');
    throw new Error(
      `Expected ${count} players but saw ${seen}. Page is showing:\n${screen}\n\nOriginal: ${String(error)}`,
    );
  }
}

/** The player this page controls. */
export async function readLocalPlayer(page: Page): Promise<RenderPlayer> {
  const players = await readPlayers(page);
  const local = players.find((player) => player.isLocal);
  if (!local) throw new Error('No local player in the rendered set');
  return local;
}

/** How this page currently sees some other player. */
export async function readRemotePlayer(page: Page, id: string): Promise<RenderPlayer | undefined> {
  const players = await readPlayers(page);
  return players.find((player) => player.id === id);
}

/** Holds a movement key down for a while so the change is unambiguous. */
export async function holdKey(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  // Let the last inputs reach the host and the next snapshot come back.
  await page.waitForTimeout(300);
}

export async function readDebugOverlay(page: Page): Promise<Record<string, string>> {
  const text = (await page.locator('.debug-overlay').textContent()) ?? '';
  const stats: Record<string, string> = {};

  for (const line of text.split('\n')) {
    const [key, ...rest] = line.trim().split(/\s+/);
    if (key && rest.length > 0) stats[key] = rest.join(' ');
  }
  return stats;
}
