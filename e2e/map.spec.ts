import { BEFORE, expect, test } from './fixtures';

test('map opens for a trip and says so when tiles are unreachable', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  await page.goto('./');
  await page.getByRole('button', { name: 'New trip' }).click();
  const search = page.getByPlaceholder('Station, scenic line or past trip');
  await search.fill('Chur');
  await search.press('Enter');
  await page.getByRole('button', { name: 'Add a station' }).click();
  await search.fill('St. Moritz');
  await search.press('Enter');

  await page.getByRole('button', { name: 'Map' }).click();
  await expect(page.getByRole('region', { name: 'Map' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Map tiles could not be loaded.');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chur → St. Moritz');
});
