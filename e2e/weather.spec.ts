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
  // The stripe is named, and a tap says how to read it (review of 11 Nov 2026).
  const key = page.getByRole('button', { name: 'Weather ↓' });
  await key.click();
  await expect(page.locator('.wx-key-text')).toContainText('gold for sun');
  await key.click();
  await expect(page.locator('.wx-key-text')).toHaveCount(0);
  await wet.click();
  await expect(line.locator('.wx-tip')).toContainText(/Forecast of \d\d:\d\d, Open-Meteo/);
  // The temperature there, a true minus below zero (0.38.0).
  await expect(line.locator('.wx-tip')).toContainText(/ · (\u2212)?\d+° · Rain 70 %/);
  // A tap elsewhere closes it (Safari gives no blur on a tapped button).
  await page.locator('h1').first().dispatchEvent('pointerdown');
  await expect(line.locator('.wx-tip')).toHaveCount(0);
  await wet.click();

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

test('a trip more than a week ahead: no stripe, the day the weather comes from', async ({
  page,
}) => {
  // Twelve days before the fixtures' day.
  await page.clock.install({ time: Date.parse(`${FIXTURE_DATE}T08:00:00Z`) - 12 * 86_400_000 });
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'Far' }));
  const line = page.getByRole('list', { name: 'The trip' });
  await expect(line.locator('.wx-far')).toHaveText(/^Weather from /, { timeout: 15_000 });
  await expect(line.locator('.wx-cell')).toHaveCount(0);
});

// Reported, 0.40.0: under way the stripe dimmed row by row, a whole ride behind the train. Now
// it is dimmed down to where you are and marked there, in step with the line's marker.
test('under way, the stripe is dimmed to where you are, and marked there', async ({ page }) => {
  await page.clock.install({ time: new Date(`${FIXTURE_DATE}T07:50:00Z`) }); // planned at 08:50
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'Wx live' }));
  await page.clock.runFor('25:00'); // 09:15, on the R62
  const line = page.getByRole('list', { name: 'The trip', exact: true });
  const now = line.locator('.wx-now');
  await expect(now).toHaveCount(1, { timeout: 15_000 });
  // Its lower edge where the ride's rail turns red: inside the ride you are on.
  const ride = line.locator(':scope > li.ride.here');
  const [r, n] = await Promise.all([ride.boundingBox(), now.boundingBox()]);
  const bottom = n!.y + n!.height;
  expect(bottom).toBeGreaterThan(r!.y);
  expect(bottom).toBeLessThan(r!.y + r!.height);
});
