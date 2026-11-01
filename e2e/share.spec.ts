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

test('route links: a template by name, the address bar shares the route', async ({
  page,
  browser,
}) => {
  await page.goto('./#/r/@bernina');
  await expect(page.getByText('Someone shared this tour with you.')).toBeVisible();
  await expect(page.locator('.line .stop').first()).toContainText('St. Moritz');
  await page.getByRole('button', { name: 'Save to my routes' }).click();

  // The builder's address is the route (where, not when): readable, and it follows edits.
  await expect(page).toHaveURL(/#\/tour\/[\w-]+\?s=st-moritz\.\d+\.@bernina~[^&?]*tirano[^&?]*$/);
  await page.getByLabel('Tour name').fill('Bernina day');
  await expect(page).toHaveURL(/&name=Bernina%20day$/);
  const url = page.url();

  // On another device (no saved routes) the same address offers the route to save.
  const other = await browser.newPage({ baseURL: new URL('./', url).href });
  await other.goto(url);
  await expect(other.getByRole('heading', { level: 1 })).toHaveText('Bernina day');
  await expect(other.locator('.line .stop').last()).toContainText('Tirano');
  await other.close();
});
