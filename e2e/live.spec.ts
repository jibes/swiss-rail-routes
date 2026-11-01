import { encodeTour } from '../src/core/export/share';
import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { expect, test } from './fixtures';

// T5 (Interlaken Ost 09:04 → Kleine Scheidegg), lived through with a controlled clock.
// Live calls (/journey) are not recorded: the screen falls back to timetable times.
test('a trip under way: next step, progress, the marker on the line', async ({ page }) => {
  await page.clock.install({ time: new Date(`${FIXTURE_DATE}T07:50:00Z`) }); // 08:50 in Zürich
  await page.goto(`./${encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'T5' })}`);
  await page.getByRole('button', { name: 'Save to my tours' }).click();
  await page.getByRole('button', { name: 'Plan' }).click();
  await page.getByRole('button', { name: 'Save trip' }).click();
  await page.getByRole('link', { name: 'Show live' }).click();

  // Before departure.
  await expect(page.getByText('Departure', { exact: true })).toBeVisible();
  await expect(page.getByText('in 14 min')).toBeVisible();
  await expect(page.locator('.row.station.here')).toHaveCount(1);
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');

  // On the train: the marker rides along, its stops open, passed ones grey.
  await page.clock.runFor('25:00');
  await expect(page.getByText(/Get off at Lauterbrunnen|Get off at Grindelwald/)).toBeVisible();
  await expect(page.locator('.row.ride.here')).toHaveCount(1);
  await expect(page.locator('.row.ride.here .mids li').first()).toBeVisible();
  await expect(page.locator('.here-mid')).toHaveCount(1);
  await expect(page.locator('.here-mid')).toHaveText('You are here');
  await expect(page.locator('.chain.live .row.passed').first()).toBeVisible();
  expect(Number(await page.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeGreaterThan(
    0,
  );

  // The lists show the live bar; opening the app goes straight to Now.
  await page.goto('./#/trips');
  await expect(page.locator('.livebar')).toBeVisible();
  await page.goto('./');
  await expect(page).toHaveURL(/\/now$/);
});
