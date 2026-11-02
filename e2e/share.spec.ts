import { encodeTour } from '../tests/helpers/share';
import { encodeTrip } from '../src/core/export/tripShare';
import { plan } from '../src/core/planner/plan';
import { newTrip } from '../src/core/trip';
import { FIXTURE_DATE, ojpFor } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { ga, index, templates } from '../tests/helpers/timetable';
import { BEFORE, expect, guard, planShared, test } from './fixtures';

test('a shared trip opens as planned, without replanning, and saves to Trips', async ({ page }) => {
  const tour = { ...acceptanceTours(FIXTURE_DATE).T5!, name: 'Shared T5' };
  const r = await plan(tour, {
    ...ojpFor('T5'),
    templates,
    ga,
    stop: (x) => index.byRef(x),
  });
  const hash = await encodeTrip(newTrip('theirs', tour, r.legs!, r.recommended!, new Date(0)));

  let asked = 0;
  page.on('request', (q) => q.url().startsWith('https://ojp.invalid/') && asked++);
  await page.clock.install({ time: BEFORE });
  await page.goto(`./${hash}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Shared T5');
  await expect(page.locator('.summary .big')).toContainText('09:04');
  await page.getByRole('button', { name: 'Save trip' }).click();
  await expect(page).toHaveURL(/#\/trip\//);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('link', { name: /Shared T5/ })).toBeVisible();
  expect(asked, 'no planning request for a shared trip').toBe(0);
});

test('route links: a template by name opens as a new trip', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  await page.goto('./#/r/@bernina');
  await expect(page.getByText('Someone shared this route with you.')).toBeVisible();
  await expect(page.locator('.line .stop').first()).toContainText('St. Moritz');
  await page.getByRole('button', { name: 'Plan this trip' }).click();
  await expect(page).toHaveURL(/#\/trip\/[\w-]+$/);
  const entries = page.locator('.trip-line .station.entry');
  await expect(entries.first()).toContainText('St. Moritz');
  await expect(entries.last()).toContainText('Tirano');
});

test('the trip screen shares the exact timetable: a link that opens the same trip elsewhere', async ({
  page,
  context,
  browser,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => Object.defineProperty(navigator, 'share', { value: undefined }));
  await page.clock.install({ time: new Date(`${FIXTURE_DATE}T05:00:00Z`) });
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'T5 shared' }));

  // Share is in the header, visible, not under the dock.
  const share = page.getByRole('button', { name: 'Share trip' });
  await expect(share).toBeInViewport();
  await share.click();
  await expect(page.getByRole('button', { name: 'Link copied' })).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toMatch(/#\/j\//);

  const other = await browser.newPage({ baseURL: new URL('./', url).href });
  const otherErrors = await guard(other);
  await other.clock.install({ time: BEFORE });
  let asked = 0;
  other.on('request', (q) => q.url().startsWith('https://ojp.invalid/') && asked++);
  await other.goto(url);
  await expect(other.getByRole('heading', { level: 1 })).toHaveText('T5 shared');
  await expect(other.locator('.summary .big')).toContainText('09:04');
  expect(asked, 'the shared trip is the timetable itself, not replanned').toBe(0);
  otherErrors.check();
  await other.close();
});
