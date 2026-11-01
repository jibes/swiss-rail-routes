import { expect, test } from './fixtures';

test('map opens for a tour and says so when tiles are unreachable', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByLabel('Tour name')).toBeVisible();
});
