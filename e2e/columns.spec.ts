import { allowUnrecorded, BEFORE, expect, newTrip, test } from './fixtures';

// A wide screen (useColumns.ts, 0.61.0): the list beside what it opens, a trip or its map. Each
// screen works in its column as it does alone.
test.describe('two columns', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  // Reported in review (0.51.0): the list beside the trip tidied away the empty trip being made.
  test('a new trip stays open beside the list, also after a reload', async ({ page }) => {
    await page.clock.install({ time: BEFORE });
    await page.goto('./');
    await page.getByRole('button', { name: 'New trip' }).click();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/#\/trip\/[\w-]+$/);
    await page.reload();
    await expect(
      page.locator('.col-main').getByRole('button', { name: 'Choose where you start' }),
    ).toBeVisible();
  });

  test('the list and the trip side by side; the map in the trip’s column', async ({ page }) => {
    await page.clock.install({ time: BEFORE });
    allowUnrecorded(page);
    await page.goto('./');
    await expect(page.getByText('Pick a trip from the list, or start a new one.')).toBeVisible();
    await newTrip(page, 'Chur', 'St. Moritz');
    const [list, main] = [page.locator('.col-list'), page.locator('.col-main')];
    await expect(page.locator('.col-map')).toHaveCount(0);
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('Chur → St. Moritz');
    await expect(list.getByText('Chur → St. Moritz')).toBeVisible();
    const [l, m] = await Promise.all([list, main].map((c) => c.boundingBox()));
    expect(l!.x + l!.width).toBeLessThanOrEqual(m!.x + 1);
    expect(m!.width).toBeGreaterThan(600);
    // The add sheet opens over the trip's column, not over the list.
    await main.getByRole('button', { name: 'Add a station' }).click();
    const sheet = page.getByPlaceholder('Station, scenic line or past trip');
    await expect(sheet).toBeVisible();
    const s = await sheet.boundingBox();
    expect(s!.x).toBeGreaterThanOrEqual(m!.x);
    expect(s!.x + s!.width).toBeLessThanOrEqual(m!.x + m!.width + 1);
    await page.keyboard.press('Escape');
    // The map opens in the trip's column, the list beside it; Back goes to the trip.
    await main.getByRole('button', { name: 'Map', exact: true }).click();
    await expect(main.getByRole('region', { name: 'Map' })).toBeVisible();
    await expect(list.getByText('Chur → St. Moritz')).toBeVisible();
    await main.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('Chur → St. Moritz');
    // The trip open is marked in the list; the arrow keys go through it.
    await expect(list.locator('a.card[aria-current="page"]')).toHaveCount(1);
    await list.locator('a.card').first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(list.locator('a.card').first()).toBeFocused();
    await page.screenshot({ path: 'test-results/columns-2.png' });
  });
});
