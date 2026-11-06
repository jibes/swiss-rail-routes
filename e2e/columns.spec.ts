import { allowUnrecorded, BEFORE, expect, newTrip, test } from './fixtures';

// A wide screen (useColumns.ts): the list, the trip and its map side by side; narrower, the
// trip and its map. Each screen works in its column as it does alone.
test.describe('three columns', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('list, trip and map side by side; the map address shows the trip beside it', async ({
    page,
  }) => {
    await page.clock.install({ time: BEFORE });
    allowUnrecorded(page);
    await page.goto('./');
    await expect(page.getByText('Pick a trip from the list, or start a new one.')).toBeVisible();
    await newTrip(page, 'Chur', 'St. Moritz');
    const [list, main, map] = [
      page.locator('.col-list'),
      page.locator('.col-main'),
      page.locator('.col-map'),
    ];
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('Chur → St. Moritz');
    await expect(list.getByText('Chur → St. Moritz')).toBeVisible();
    await expect(map.getByRole('region', { name: 'Map' })).toBeVisible();
    // No way back from a map beside its trip.
    await expect(map.getByRole('button', { name: 'Back', exact: true })).toBeHidden();
    // Side by side, not on top of each other; with a trip open the list folds to its edge, so
    // the map has the room, and slides in over the trip while the pointer is on it.
    const [l, m, r] = await Promise.all([list, main, map].map((c) => c.boundingBox()));
    expect(l!.width).toBeLessThanOrEqual(21);
    expect(l!.x + l!.width).toBeLessThanOrEqual(m!.x + 1);
    const card = list.locator('a.card').first();
    await expect(card).not.toBeInViewport();
    await list.hover({ position: { x: 10, y: 400 } });
    await expect(card).toBeInViewport();
    await page.mouse.move(900, 400);
    await expect(card).not.toBeInViewport();
    expect(m!.x + m!.width).toBeLessThanOrEqual(r!.x + 1);
    expect(r!.width).toBeGreaterThan(400);
    // The add sheet opens over the trip's column, not over the list or the map.
    await main.getByRole('button', { name: 'Add a station' }).click();
    const sheet = page.getByPlaceholder('Station, scenic line or past trip');
    await expect(sheet).toBeVisible();
    const s = await sheet.boundingBox();
    expect(s!.x).toBeGreaterThanOrEqual(m!.x);
    expect(s!.x + s!.width).toBeLessThanOrEqual(m!.x + m!.width + 1);
    // Pick on the map: the map beside the trip adds, no other map; the trip stays beside it.
    await main.getByRole('button', { name: /Pick on the map/ }).click();
    await expect(map.getByText(/^From St\. Moritz at /)).toBeVisible();
    await expect(page.locator('.mapview')).toHaveCount(1);
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('Chur → St. Moritz');
    await map.getByRole('button', { name: 'Done' }).click();
    await expect(map.getByText(/^From St\. Moritz at /)).toHaveCount(0);
    // The trip's map address: the trip in its column, the map beside it.
    const id = new URL(page.url()).hash.split('/')[2]!;
    await page.goto(`./#/trip/${id}/map`);
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('Chur → St. Moritz');
    await expect(map.getByRole('region', { name: 'Map' })).toBeVisible();
    // The station under the pointer is ringed on the map beside (nothing breaks on the way).
    await main.locator('li.station[data-stop]').first().hover();
    // The trip open is marked in the list; the arrow keys go through it.
    await expect(list.locator('a.card[aria-current="page"]')).toHaveCount(1);
    // By keyboard too: a card focused slides it in.
    await list.locator('a.card').first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(list.locator('a.card').first()).toBeFocused();
    await expect(card).toBeInViewport();
    await page.screenshot({ path: 'test-results/columns-3.png' });
  });
});

test.describe('two columns', () => {
  test.use({ viewport: { width: 1000, height: 800 } });

  test('the trip and its map; the list on its own', async ({ page }) => {
    await page.clock.install({ time: BEFORE });
    allowUnrecorded(page);
    await newTrip(page, 'Chur', 'St. Moritz');
    await expect(page.locator('.col-list')).toHaveCount(0);
    await expect(page.locator('.col-main').getByRole('heading', { level: 1 })).toHaveText(
      'Chur → St. Moritz',
    );
    await expect(page.locator('.col-map').getByRole('region', { name: 'Map' })).toBeVisible();
    await page.goto('./');
    await expect(page.locator('.col-map')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New trip' })).toBeVisible();
  });
});
