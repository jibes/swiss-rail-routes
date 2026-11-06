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
  const wet = line.locator('.wx-cell:has(.wx-bar)').first();
  await expect(wet).toBeVisible();
  await expect(wet).toHaveAttribute('aria-label', /: Rain 70 %$/);
  await wet.click();
  await expect(line.locator('.wx-tip')).toContainText(/Forecast of \d\d:\d\d, Open-Meteo/);
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
