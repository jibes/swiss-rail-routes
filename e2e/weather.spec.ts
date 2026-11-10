import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { encodeTour } from '../tests/helpers/share';
import { BEFORE, expect, planShared, test } from './fixtures';

// Weather along the line (0.37.0): a stripe at the right, the sky's colour row by row, a bar where
// rain is likely, its values on a tap. The Worker's forecast is made up here (fixtures.ts).
test('the weather stripe: a cell a row, bars where rain is likely, values on a tap', async ({
  page,
}) => {
  await page.clock.install({ time: BEFORE });
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T1!, name: 'Weather' }));
  const line = page.getByRole('list', { name: 'The trip' });
  await expect(line).toHaveClass(/\bwx\b/, { timeout: 15_000 });
  // Every station and ride has its cell, so the stripe runs unbroken.
  const rows = line.locator(':scope > li.station, :scope > li.ride');
  await expect(line.locator(':scope > li .wx-cell')).toHaveCount(await rows.count());
  // Rain at the third place of every three from 13:00: bars, and the stay note where it rains.
  const wet = line.locator(':scope > li.station .wx-cell:has(.wx-bar)').first();
  await expect(wet).toBeVisible();
  await expect(wet).toHaveAttribute('aria-label', /: Rain 70 %$/);
  await wet.click();
  await expect(line.locator('.wx-tip')).toContainText(/Forecast of \d\d:\d\d, Open-Meteo/);
  // The temperature there, a true minus below zero (0.38.0).
  await expect(line.locator('.wx-tip')).toContainText(/ · (\u2212)?\d+° · Rain 70 %/);

  // A ride: its rain the highest along the way, said so; its bar only while its stops are folded,
  // as each stop shows its own once open.
  // A stop inside a ride: its card's title readable (it was painted in the card's colour).
  await line.locator('.mids-toggle').first().click();
  const mid = line.locator('.wx-mid').first();
  await mid.click();
  const title = mid.locator('.wx-tip b');
  await expect(title).not.toBeEmpty();
  const [fg, bg] = await title.evaluate((b) => [
    getComputedStyle(b).color,
    getComputedStyle(b.closest('.wx-tip')!).backgroundColor,
  ]);
  expect(fg).not.toBe(bg);
  await line.locator('.mids-toggle').first().click();

  const wetRide = line.locator(':scope > li.ride:has(.wx-cell .wx-bar):has(.mids-toggle)').first();
  // By its place, as the selector stops matching once its bar goes.
  const at = await wetRide.evaluate((li) => [...li.parentElement!.children].indexOf(li));
  const ride = line.locator(':scope > li').nth(at);
  const own = ride.locator(':scope > .wx-cell');
  await expect(own).toHaveAttribute('aria-label', /: Rain up to \d+ % along the way$/);
  await ride.locator('.mids-toggle').click();
  await expect(own.locator('.wx-bar')).toHaveCount(0);
  await expect(ride.locator('.wx-mid .wx-bar').first()).toBeVisible();
});

test('the weather on the map: each named station’s temperature after its name', async ({
  page,
}) => {
  await page.clock.install({ time: BEFORE });
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T1!, name: 'Map wx' }));
  await expect(page.getByRole('list', { name: 'The trip' })).toHaveClass(/\bwx\b/, {
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.locator('.map-name .map-temp').first()).toHaveText(/^ (\u2212)?\d+°$/, {
    timeout: 15_000,
  });
});

test('a trip more than a week ahead: no stripe, the day the weather comes from', async ({
  page,
}) => {
  // Twelve days before the fixtures' day.
  await page.clock.install({ time: Date.parse(`${FIXTURE_DATE}T08:00:00Z`) - 12 * 86_400_000 });
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'Far' }));
  const line = page.getByRole('list', { name: 'The trip' });
  await expect(line.locator('.wx-far')).toHaveText(/^Weather from /, { timeout: 15_000 });
  await expect(line.locator('.wx-cell')).toHaveCount(0);
  // The tap card on the map: one line each (reported: all on one line, 0.38.0). The card is the
  // map's popup round the line's words; its layout checked on one built as MapLibre builds it.
  const display = await page.evaluate(() => {
    const pop = document.createElement('div');
    pop.className = 'maplibregl-popup wx-pop';
    pop.innerHTML =
      '<div class="maplibregl-popup-content"><div role="status"><b>A</b><span>B</span></div></div>';
    document.body.append(pop);
    const shown = getComputedStyle(pop.querySelector('[role=status]')!).display;
    pop.remove();
    return shown;
  });
  expect(display).toBe('grid');
});
