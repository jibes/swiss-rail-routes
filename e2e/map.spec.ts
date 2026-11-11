import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { encodeTour } from '../tests/helpers/share';
import { allowUnrecorded, BEFORE, expect, newTrip, planShared, test } from './fixtures';

test('map opens for a trip and says so when tiles are unreachable', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  // The map needs no timetable: the trip may be planned meanwhile, from an hour nothing answers.
  allowUnrecorded(page);
  await newTrip(page, 'Chur', 'St. Moritz');

  await page.getByRole('button', { name: 'Map' }).click();
  await expect(page.getByRole('region', { name: 'Map' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Map tiles could not be loaded.');
  // The stations you get off at are named, without the tile host's fonts.
  await expect(page.locator('.map-name')).toHaveText(['Chur', 'St. Moritz']);
  // The route is drawn all the same, on a plain ground: the rail's red is on the map, with
  // arrows the way it goes (their dark fill: the red line on the light ground is never darker).
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
          let dark = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i]! > 150 && d[i + 1]! < 80 && d[i + 2]! < 80) red++;
            if (d[i]! > 90 && d[i]! < 140 && d[i + 1]! < 45 && d[i + 2]! < 45) dark++;
          }
          return red > 50 && dark > 20;
        }, png);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chur → St. Moritz');
});

// In dark mode the plain ground is dark (a light one glares), the route still red on it.
test('the plain ground follows dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.clock.install({ time: BEFORE });
  // A dark device asks for the dark map (0.32.0), never the light one.
  const styles: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/styles/')) styles.push(new URL(r.url()).pathname);
  });
  // The map needs no timetable: the trip may be planned meanwhile, from an hour nothing answers.
  allowUnrecorded(page);
  await newTrip(page, 'Chur', 'St. Moritz');
  await page.getByRole('button', { name: 'Map' }).click();
  await expect(page.getByRole('status')).toHaveText('Map tiles could not be loaded.');
  expect(styles).toContain('/styles/dark');
  expect(styles).not.toContain('/styles/positron');
  await expect
    .poll(
      async () => {
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
          // A corner below the bar: the ground.
          const at = 4 * (c.width * Math.floor(c.height * 0.6) + 2);
          const ground = (d[at]! + d[at + 1]! + d[at + 2]!) / 3;
          let red = 0;
          for (let i = 0; i < d.length; i += 4)
            if (d[i]! > 150 && d[i + 1]! < 80 && d[i + 2]! < 80) red++;
          return ground < 60 && red > 50;
        }, png);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
});

// T5 (Interlaken Ost 09:04 →) by a controlled clock; a location near Interlaken Ost.
const AT_INTERLAKEN = { latitude: 46.69, longitude: 7.87, accuracy: 30 };
const watches = (page: Page) =>
  page.evaluate(() => (window as unknown as { watches: number }).watches);

const openT5 = async (page: Page, zurichTime: string) => {
  await page.addInitScript(() => {
    const g = navigator.geolocation;
    const watch = g.watchPosition.bind(g);
    const w = window as unknown as { watches: number };
    w.watches = 0;
    g.watchPosition = (...a) => {
      w.watches++;
      return watch(...a);
    };
  });
  await page.clock.install({ time: new Date(`${FIXTURE_DATE}T07:50:00Z`) });
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'T5' }));
  await page.clock.setSystemTime(new Date(`${FIXTURE_DATE}T${zurichTime}:00+01:00`));
  await page.clock.runFor(16_000);
  await page.getByRole('button', { name: 'Map' }).click();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
};
const inView = async (page: Page, marker: Locator) => {
  const box = (await marker.boundingBox())!;
  const size = page.viewportSize()!;
  expect(box.x).toBeGreaterThan(0);
  expect(box.x).toBeLessThan(size.width);
  expect(box.y).toBeGreaterThan(0);
  expect(box.y).toBeLessThan(size.height);
};

test('where you are: by the time, by the device once turned on, the time again when it stops', async ({
  page,
  context,
}) => {
  await context.setGeolocation(AT_INTERLAKEN);
  await context.grantPermissions(['geolocation']);
  await openT5(page, '09:15');

  // By the time, with nothing asked of the device.
  const estimate = page.locator('.map-here.estimate');
  const location = page.locator('.map-here.location');
  const button = page.getByRole('button', { name: 'Show my location' });
  await expect(estimate).toBeVisible();
  await inView(page, estimate);
  await expect(page.locator('.map-source.estimate')).toHaveText(
    /^By the timetable you are between/,
  );
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(await watches(page)).toBe(0);
  const axe = async () =>
    expect(
      (
        await new AxeBuilder({ page })
          .include('.map-bar')
          .include('.map-notes')
          .include('.map-here')
          .analyze()
      ).violations,
    ).toEqual([]);
  await axe();

  // Turned on: one marker, the device's.
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(location).toBeVisible();
  await expect(estimate).toHaveCount(0);
  await inView(page, location);
  await expect(page.locator('.map-source.location')).toHaveText(
    'Your location. It stays on this device.',
  );
  await page.emulateMedia({ colorScheme: 'dark' });
  await axe();
  await page.emulateMedia({ colorScheme: 'light' });

  // Somewhere else: said, and the map stays where it is.
  await context.setGeolocation({ latitude: 46.2, longitude: 6.14, accuracy: 30 });
  await expect(page.locator('.map-source.location')).toHaveText(
    'Your location is outside this view.',
  );

  // Off: no location any more, the estimate again.
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(location).toHaveCount(0);
  await expect(estimate).toBeVisible();

  // On again, then no news (a tunnel) for over two minutes: the estimate, and it says so.
  await context.setGeolocation(AT_INTERLAKEN);
  await button.click();
  await expect(location).toBeVisible();
  await page.clock.runFor('02:30');
  await expect(estimate).toBeVisible();
  await expect(location).toHaveCount(0);
  await expect(page.locator('.map-notes [role=status]')).toHaveText('Waiting for your location.');

  // Remembered on this device: on after a reload, with no tap.
  await page.reload();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(location).toBeVisible();
});

test('location refused: off again, said, the estimate stays, not asked again', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.geolocation.watchPosition = (_ok, err) => {
      err?.({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError);
      return 1;
    };
    navigator.geolocation.clearWatch = () => undefined;
  });
  await openT5(page, '09:15');
  const button = page.getByRole('button', { name: 'Show my location' });
  await expect(page.locator('.map-here.estimate')).toBeVisible();
  await button.click();
  await expect(page.locator('.map-notes [role=status]')).toHaveText(/^Location is not allowed/);
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.map-here.estimate')).toBeVisible();
  await page.reload();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.map-notes [role=status]')).toHaveCount(0);
});

test('before the first train, and with the trip over: no marker by the time', async ({ page }) => {
  await openT5(page, '08:55');
  await expect(page.getByRole('button', { name: 'Show my location' })).toBeVisible();
  await expect(page.locator('.map-here')).toHaveCount(0);
  await expect(page.locator('.map-source')).toHaveCount(0);
  await page.clock.setSystemTime(new Date(`${FIXTURE_DATE}T22:00:00+01:00`));
  await page.clock.runFor(16_000);
  await expect(page.locator('.map-here')).toHaveCount(0);
  await expect(page.locator('.map-source')).toHaveCount(0);
});

// Android 15 draws edge to edge: the map runs under the system bars, its controls never (the
// attribution's "i" sat behind the bar). The inset is set as the variable the styles read
// before env(), which Playwright cannot set.
test('map controls clear the system bars; turned or tilted, a tap puts north up', async ({
  page,
}) => {
  await page.clock.install({ time: BEFORE });
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.setProperty('--inset-bottom', '48px');
      document.documentElement.style.setProperty('--inset-top', '24px');
    });
  });
  allowUnrecorded(page);
  await newTrip(page, 'Chur', 'St. Moritz');
  await page.getByRole('button', { name: 'Map' }).click();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  const height = page.viewportSize()!.height;
  const corner = await page.locator('.maplibregl-ctrl-bottom-right').boundingBox();
  expect(corner!.y + corner!.height).toBeLessThanOrEqual(height - 48 + 0.5);
  const bar = await page.locator('.map-bar').boundingBox();
  expect(bar!.y).toBeGreaterThanOrEqual(24 + 12 - 0.5);

  // Not turned: no compass. Shift + arrows turn and tilt the map, as a two-finger gesture does.
  const north = page.getByRole('button', { name: 'North up' });
  await expect(north).toHaveCount(0);
  await page.locator('.maplibregl-canvas').focus();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowUp');
  await expect(north).toBeVisible();
  // The needle points north: turned against the map.
  const turned = await north.locator('svg').evaluate((s) => (s as SVGElement).style.transform);
  expect(turned).toMatch(/rotate\(-?\d/);
  expect(turned).not.toBe('rotate(0deg)');
  await north.click();
  await expect(north).toHaveCount(0);
});

// Review of 11 Nov 2026: zoomed out, T1's names lay on each other and its start and end, the
// same station, were written twice ("Zürich HBIB"). Kept apart, each station once.
test('the map’s station names never lie on each other', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T1!, name: 'Names' }));
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.locator('.map-name').first()).toBeVisible();
  await expect(page.locator('.map-name', { hasText: /^Zürich HB/ })).toHaveCount(1);
  await expect(page.locator('.map-name', { hasText: /, Bahnhof/ })).toHaveCount(0);
  const overlapping = await page.locator('.map-name').evaluateAll((els) => {
    const boxes = els
      .filter((e) => (e as HTMLElement).style.visibility !== 'hidden')
      .map((e) => e.getBoundingClientRect());
    let n = 0;
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i]!, boxes[j]!];
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) n++;
      }
    return n;
  });
  expect(overlapping).toBe(0);
});
