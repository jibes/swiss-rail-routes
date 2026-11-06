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

// Where no service worker keeps it (the Android shell has none; here: workers blocked), the page
// keeps the map as seen itself, by the same rules (src/io/mapCache.ts).
test.describe('without a service worker', () => {
  test.use({ serviceWorkers: 'block' });

  test('the page keeps the map as seen, and opens it offline', async ({ page, context }) => {
    await page.clock.install({ time: BEFORE });
    await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'T5' }));
    expect(await page.evaluate(() => !!navigator.serviceWorker?.controller)).toBe(false);
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
    // Kept by the page: with its time, which the service worker's entries do not carry.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const c = await caches.open('srr-mapstyle-v1');
          const [k] = await c.keys();
          return k ? (await c.match(k))?.headers.get('x-srr-kept-at') : null;
        }),
      )
      .toMatch(/^\d+$/);
    expect(asked.every((u) => u.startsWith('https://tiles.openfreemap.org/styles/'))).toBe(true);

    await context.unrouteAll();
    await context.route('https://tiles.openfreemap.org/**', (r) => r.abort());
    // The tile host gone, the app's own files still there (in the Android shell they are on the
    // device): leave the map, open it again.
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Map' }).click();
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await expect.poll(() => ground(page), { timeout: 15_000 }).toBeGreaterThan(0.5);
    await expect(page.getByText('Map tiles could not be loaded.')).toHaveCount(0);
  });
});

// Keep map for offline (0.34.0): the trip's route at zoom 10–13, asked of the tile host only on
// the tap, kept where the map as seen is (here the page's own cache, no service worker).
test.describe('keep the map for offline', () => {
  test.use({ serviceWorkers: 'block' });

  test('on the tap only: the style, its tiles along the route, kept on the device', async ({
    page,
    context,
  }) => {
    await page.clock.install({ time: BEFORE });
    const asked: string[] = [];
    await context.unrouteAll();
    await context.route('https://tiles.openfreemap.org/**', (r) => {
      const url = r.request().url();
      asked.push(url);
      const cors = { 'Access-Control-Allow-Origin': '*' };
      if (url.endsWith('/styles/positron'))
        return r.fulfill({
          json: {
            ...STYLE,
            sources: {
              openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
            },
          },
          headers: cors,
        });
      if (url.endsWith('/planet'))
        return r.fulfill({
          json: { tiles: ['https://tiles.openfreemap.org/planet/w1/{z}/{x}/{y}.pbf'] },
          headers: cors,
        });
      return r.fulfill({ body: 'tile', headers: cors });
    });
    await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'T5' }));
    // Nothing of the route's map is asked before the tap.
    expect(asked.filter((u) => u.endsWith('.pbf'))).toEqual([]);
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: 'Keep map for offline' }).click();
    await expect(page.getByText(/^Map kept for offline \(\d+ parts\)\.$/)).toBeVisible({
      timeout: 20_000,
    });
    const tiles = asked.filter((u) => u.endsWith('.pbf'));
    expect(tiles.length).toBeGreaterThan(20);
    expect(tiles.length).toBeLessThanOrEqual(400);
    // Zoom 10 to 13 only, around Interlaken (zoom 10: x 536, y 361).
    expect(new Set(tiles.map((u) => /\/(\d+)\/\d+\/\d+\.pbf$/.exec(u)![1]))).toEqual(
      new Set(['10', '11', '12', '13']),
    );
    expect(tiles.some((u) => /\/10\/53[5-7]\/36[0-2]\.pbf$/.test(u))).toBe(true);
    const kept = await page.evaluate(
      async () => (await (await caches.open('srr-tiles-v1')).keys()).length,
    );
    expect(kept).toBe(tiles.length);
  });
});
