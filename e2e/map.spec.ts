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
  // The route is drawn all the same, on a plain ground: the rail's red is on the map.
  await expect
    .poll(
      async () => {
        const png = (await page.locator('.map').screenshot()).toString('base64');
        // Decoded in the page: a canvas reads the screenshot's pixels.
        return page.evaluate(async (b64) => {
          const img = new Image();
          img.src = `data:image/png;base64,${b64}`;
          await img.decode();
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          const g = c.getContext('2d')!;
          g.drawImage(img, 0, 0);
          const d = g.getImageData(0, 0, c.width, c.height).data;
          let red = 0;
          for (let i = 0; i < d.length; i += 4)
            if (d[i]! > 150 && d[i + 1]! < 80 && d[i + 2]! < 80) red++;
          return red;
        }, png);
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(50);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chur → St. Moritz');
});
