import { encodeTour } from '../src/core/export/share';
import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { expect, test } from './fixtures';

// T5 (Interlaken Ost 09:04 → Kleine Scheidegg), lived through with a controlled clock.
// Live calls (/journey) are not recorded: the screen falls back to timetable times.
test('a trip under way: next step, progress, the marker on the line', async ({ page }) => {
  await page.clock.install({ time: new Date(`${FIXTURE_DATE}T07:50:00Z`) }); // 08:50 in Zürich
  await page.goto(`./${encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'T5' })}`);
  await page.getByRole('button', { name: 'Save to my routes' }).click();
  await page.getByRole('button', { name: 'Plan' }).click();
  await page.getByRole('button', { name: 'Save trip' }).click();

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
  // The marker sits on the rail between the stop before and the one after it.
  const marker = await page.evaluate(() => {
    const row = document.querySelector('.row.ride.here')!;
    const dot = getComputedStyle(row.querySelector('.rail')!, '::after');
    const rail = row.querySelector('.rail')!.getBoundingClientRect();
    const y = rail.top + parseFloat(dot.top) + parseFloat(dot.height) / 2;
    const mid = row.querySelector('.here-mid')!;
    const box = (e: Element | null) => e?.getBoundingClientRect();
    const before = box(mid.previousElementSibling);
    const after = box(mid.nextElementSibling);
    return {
      y,
      from: before ? before.top + before.height / 2 : rail.top,
      to: after ? after.top + after.height / 2 : rail.bottom,
    };
  });
  expect(marker.y).toBeGreaterThanOrEqual(marker.from - 1);
  expect(marker.y).toBeLessThanOrEqual(marker.to + 1);
  await expect(page.locator('.chain.live .row.passed').first()).toBeVisible();
  expect(Number(await page.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeGreaterThan(
    0,
  );

  // The lists show the live bar; opening the app goes straight to Now.
  await page.goto('./#/trips');
  await expect(page.locator('.livebar')).toBeVisible();
  await page.goto('./');
  await expect(page).toHaveURL(/#\/trip\/[\w-]+$/);
});

test('replan from here: a spontaneous stop, update the trip, undo', async ({ page }) => {
  await page.clock.install({ time: new Date(`${FIXTURE_DATE}T08:15:00Z`) }); // 09:15, on the R62
  await page.goto(`./${encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'T5' })}`);
  await page.getByRole('button', { name: 'Save to my routes' }).click();
  await page.getByRole('button', { name: 'Plan' }).click();
  await page.getByRole('button', { name: 'Save trip' }).click();

  await page.getByRole('link', { name: 'Replan from here' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('From Zweilütschinen');
  const search = page.locator('.picker input');
  await search.fill('Wengen');
  await search.press('Enter'); // the first match: Wengen station

  const rows = page.getByRole('list', { name: 'Stops' }).getByRole('listitem');
  await expect(rows.nth(1)).toContainText('Wengen');
  await rows
    .nth(1)
    .getByRole('button', { name: /^Wengen/ })
    .click();
  await rows.nth(1).getByRole('combobox', { name: 'Stay at Wengen' }).click();
  await page.getByRole('option', { name: '30′' }).click();
  await rows.nth(1).getByRole('combobox', { name: 'Instead of Wengen' }).press('Enter');
  await page.getByRole('button', { name: 'Find connections' }).click();
  await page.getByRole('button', { name: 'Update trip' }).click();

  // Back on Now: the new plan (via Wengen), undo available.
  await expect(page).toHaveURL(/#\/trip\/[\w-]+$/);
  await expect(page.locator('.chain .leg')).toHaveCount(3);
  await expect(page.locator('.chain')).toContainText('Wengen');
  await page.getByRole('button', { name: 'Undo last replan' }).click();
  await expect(page.locator('.chain .leg')).toHaveCount(1);
});

test('one trip screen: edit all of it before departure, plan it again afterwards', async ({
  page,
}) => {
  await page.clock.install({ time: new Date(`${FIXTURE_DATE}T05:00:00Z`) }); // 06:00, hours before
  await page.goto(`./${encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'T5' })}`);
  await page.getByRole('button', { name: 'Save to my routes' }).click();
  await page.getByRole('button', { name: 'Plan' }).click();
  await page.getByRole('button', { name: 'Save trip' }).click();

  // Before departure: the timetable, and editing covers everything (start, date, time).
  await expect(page.locator('.summary .big')).toContainText('09:04');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.getByRole('link', { name: 'Edit trip' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edit trip');
  const rows = page.getByRole('list', { name: 'Stops' }).getByRole('listitem');
  await expect(rows.first().getByRole('button', { name: /^Move/ })).toBeVisible();
  await expect(page.getByLabel('Date')).toBeVisible();
  await page.getByRole('button', { name: 'Find connections' }).click();
  await page.getByRole('button', { name: 'Update trip' }).click();
  await expect(page).toHaveURL(/#\/trip\/[\w-]+$/);
  await expect(page.getByText('Replanned', { exact: false })).toBeVisible();

  // Afterwards: the record, and the route planned again as a new route.
  await page.clock.runFor('10:00:00');
  await page.getByRole('button', { name: 'Plan again' }).click();
  await expect(page).toHaveURL(/#\/tour\//);
  await expect(page.getByLabel('Tour name')).toHaveValue('T5');
});
