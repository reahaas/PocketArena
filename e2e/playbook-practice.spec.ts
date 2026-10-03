import { expect, test } from '@playwright/test';

test('lets a player practice one role while the other playbook roles run as ghosts', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pocketarena.plays.v1',
      JSON.stringify([
        {
          id: 'solo-practice',
          name: 'Solo Practice',
          durationMs: 2200,
          sport: 'soccer',
          assignments: [
            {
              team: 'A',
              number: 4,
              steps: [
                { startMs: 0, durationMs: 1000, fromX: 300, fromY: 400, toX: 620, toY: 400 },
              ],
            },
            {
              team: 'B',
              number: 8,
              steps: [
                { startMs: 0, durationMs: 1500, fromX: 1200, fromY: 500, toX: 900, toY: 500 },
              ],
            },
          ],
        },
      ]),
    );
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'PLAYBOOK' }).click();
  await page.getByRole('button', { name: 'Practice' }).click();
  await expect(page.getByText('Choose the player you want to control.')).toBeVisible();
  await page.locator('.playbook-practice-select').selectOption('B:8');
  await page.getByRole('button', { name: 'Start Practice' }).click();

  await expect(page.locator('.joystick-zone')).toBeAttached();
  await expect(page.locator('.playbook-practice-countdown')).toHaveText('GO!', { timeout: 5_000 });
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(450);
  await page.keyboard.up('ArrowLeft');
  await expect(page.getByRole('heading', { name: 'PRACTICE RESULTS: SOLO PRACTICE' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('OVERALL', { exact: true })).toBeVisible();
  await expect(page.getByText('POSITION', { exact: true })).toBeVisible();
  await expect(page.getByText('TIMING', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Share Video + Score' })).toBeVisible();
});
