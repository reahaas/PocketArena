import { expect, test } from '@playwright/test';

test('sets a travel-time minimum from step distance and allows a longer duration', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'PLAYBOOK' }).click();
  await page.getByRole('button', { name: '+ New Play' }).click();
  await page.getByRole('button', { name: '+ Add Player' }).first().click();
  await page.getByRole('button', { name: '1', exact: true }).click();

  const canvas = page.locator('canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Playbook editor field was not rendered.');
  const y = bounds.y + bounds.height * 0.5;
  await page.mouse.click(bounds.x + bounds.width * 0.2, y);
  await page.mouse.click(bounds.x + bounds.width * 0.7, y);

  const duration = page.locator('.playbook-time-input').nth(1);
  const minimumSeconds = await duration.getAttribute('min');
  expect(minimumSeconds).not.toBeNull();
  const minimum = Number(minimumSeconds);
  expect(minimum).toBeGreaterThan(0.5);
  await expect(page.locator('.playbook-minimum-duration')).toContainText(
    `Minimum for this distance: ${minimum.toFixed(2)}s`,
  );
  await expect(duration).toHaveValue(minimum.toFixed(2));

  await duration.fill((minimum + 1).toFixed(2));
  await page.getByRole('button', { name: '+ Add Step' }).click();
  const savedDurationMs = await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem('pocketarena.playbookDraft.v1') ?? 'null');
    return draft?.assignments?.[0]?.steps?.[0]?.durationMs;
  });
  expect(savedDurationMs).toBe(Math.round((minimum + 1) * 1000));
});
