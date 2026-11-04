// The map as it was seen is kept (service worker, web only): offline, it comes back as it was
// instead of the plain ground. Nothing is asked of the tile host the map did not ask for.
import { encodeTour } from '../tests/helpers/share';
import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { BEFORE, expect, planShared, test } from './fixtures';

const STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: 'ground', type: 'background', paint: { 'background-color': '#d8e4d0' } }],
};

/** Share of the map's pixels in the style's own ground colour (#d8e4d0), decoded in the page. */
async function ground(page: import('@playwright/test').Page) {
  const png = (await page.locator('.map').screenshot()).toString('base64');
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
    let n = 0;
    for (let i = 0; i < d.length; i += 4)
      if (
        Math.abs(d[i]! - 0xd8) < 4 &&
        Math.abs(d[i + 1]! - 0xe4) < 4 &&
        Math.abs(d[i + 2]! - 0xd0) < 4
      )
        n++;
    return n / (d.length / 4);
  }, png);
}

test('a map seen once opens offline from the device', async ({ page, context }) => {
  await page.clock.install({ time: BEFORE });
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'T5' }));
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Controlled from now on: the map's requests go through the service worker.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const asked: string[] = [];
  await context.unrouteAll();
  await context.route('https://tiles.openfreemap.org/**', (r) => {
    asked.push(r.request().url());
    return r.request().url().endsWith('/styles/positron')
      ? r.fulfill({ json: STYLE, headers: { 'Access-Control-Allow-Origin': '*' } })
      : r.abort();
  });
  await page.getByRole('button', { name: 'Map' }).click();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await expect.poll(() => ground(page), { timeout: 15_000 }).toBeGreaterThan(0.5);
  await expect(page.getByText('Map tiles could not be loaded.')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(async () => (await (await caches.open('srr-mapstyle-v1')).keys()).length),
    )
    .toBeGreaterThan(0);
  expect(asked.every((u) => u.startsWith('https://tiles.openfreemap.org/styles/'))).toBe(true);

  // Offline: the style from the device, not the plain ground.
  await context.unrouteAll();
  await context.route('https://tiles.openfreemap.org/**', (r) => r.abort());
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await expect.poll(() => ground(page), { timeout: 15_000 }).toBeGreaterThan(0.5);
  await expect(page.getByText('Map tiles could not be loaded.')).toHaveCount(0);
});
