import { expect, test } from '@playwright/test';

test('map opens for a tour and says so when tiles are unreachable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Tests never reach the network: the tile host fails here.
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort());

  await page.goto('./');
  await page.getByRole('button', { name: 'New tour' }).click();
  const search = page.locator('.picker input');
  await search.fill('Chur');
  await search.press('Enter');
  await search.fill('St. Moritz');
  await search.press('Enter');

  await page.getByRole('button', { name: 'Map' }).click();
  await expect(page.getByRole('region', { name: 'Map' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Map tiles could not be loaded.');
  await page.getByRole('button', { name: /Back/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Untitled tour');
  expect(errors).toEqual([]);
});
