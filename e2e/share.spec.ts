import { encodeTrip } from '../src/core/export/tripShare';
import { plan } from '../src/core/planner/plan';
import { newTrip } from '../src/core/trip';
import { FIXTURE_DATE, ojpFor } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { ga, index, segments, templates } from '../tests/helpers/timetable';
import { expect, test } from './fixtures';

test('a shared trip opens as planned, without replanning, and saves to Trips', async ({ page }) => {
  const tour = { ...acceptanceTours(FIXTURE_DATE).T5!, name: 'Shared T5' };
  const r = await plan(tour, {
    ...ojpFor('T5'),
    templates,
    segments,
    ga,
    stop: (x) => index.byRef(x),
  });
  const hash = await encodeTrip(newTrip('theirs', tour, r.legs!, r.recommended!, new Date(0)));

  let asked = 0;
  page.on('request', (q) => q.url().startsWith('https://ojp.invalid/') && asked++);
  await page.goto(`./${hash}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Shared T5');
  await expect(page.locator('.summary .big')).toContainText('09:04');
  await page.getByRole('button', { name: 'Save to my trips' }).click();
  await expect(page).toHaveURL(/#\/trip\//);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('link', { name: /Shared T5/ })).toBeVisible();
  expect(asked, 'no planning request for a shared trip').toBe(0);
});
