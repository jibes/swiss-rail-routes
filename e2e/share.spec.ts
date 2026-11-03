import { encodeTour } from '../tests/helpers/share';
import { encodeTrip } from '../src/core/export/tripShare';
import { plan } from '../src/core/planner/plan';
import { setEntryStay } from '../src/core/line';
import { expandLegs } from '../src/core/tour';
import { newTrip } from '../src/core/trip';
import { FIXTURE_DATE, ojpFor } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { addWaypoint, newTour } from '../tests/helpers/edit';
import { conn, DATE, ga, index, ref, ride, templates } from '../tests/helpers/timetable';
import type { Page } from '@playwright/test';
import { BEFORE, expect, guard, planShared, test } from './fixtures';

/** The last timetable answer `page` got, to answer the rides of the same trip with. */
function recordAnswers(page: Page) {
  let xml = '';
  page.on('response', (r) => {
    if (r.url().endsWith('/trip') && r.ok()) void r.text().then((t) => (xml = t || xml));
  });
  return () => xml;
}

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
  await expect(page.locator('.hero-times')).toContainText('09:04');
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
  await expect(page.locator('.trip-line .station').first()).toContainText('St. Moritz');
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
  const answer = recordAnswers(page);
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'T5 shared' }));

  // Share is in the header, visible, not under the dock.
  const share = page.getByRole('button', { name: 'Share trip' });
  await expect(share).toBeInViewport();
  await share.click();
  await expect(page.getByRole('button', { name: 'Link copied' })).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toMatch(/#\/s\//);
  expect(url.length, 'short enough for any messenger').toBeLessThan(800);

  const other = await browser.newPage({ baseURL: new URL('./', url).href });
  const otherErrors = await guard(other);
  await other.clock.install({ time: BEFORE });
  // The link holds the trains; each is asked for again, on its own: not planned anew.
  const asked: { vias: unknown[] }[] = [];
  await other.route(/\/trip$/, (r) => {
    asked.push(r.request().postDataJSON() as { vias: unknown[] });
    return r.fulfill({ contentType: 'application/xml', body: answer() });
  });
  await other.goto(url);
  await expect(other.getByRole('heading', { level: 1 })).toHaveText('T5 shared');
  await expect(other.locator('.hero-times')).toContainText('09:04');
  await expect(other.getByRole('status').filter({ hasText: 'Up to date' })).toBeAttached();
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every((q) => q.vias.length === 0)).toBe(true);
  await expect(other.locator('main')).toContainText(/\d+ stops?/);
  otherErrors.check();
  await other.close();
});

test('the trains still show when the rest cannot be loaded; try again gets it', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => Object.defineProperty(navigator, 'share', { value: undefined }));
  await page.clock.install({ time: new Date(`${FIXTURE_DATE}T05:00:00Z`) });
  const answer = recordAnswers(page);
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'T5 bare' }));
  await page.getByRole('button', { name: 'Share trip' }).click();
  await expect(page.getByRole('button', { name: 'Link copied' })).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());

  await page.route(/\/trip$/, (r) => r.abort());
  await page.goto('about:blank');
  await page.goto(url);
  await expect(page.locator('.hero-times')).toContainText('09:04');
  // Said above the line, and the line marks no station missed: the stops are not known yet.
  const bare = page.getByText('Showing the trains and times');
  await expect(bare).toBeVisible();
  expect(await bare.boundingBox().then((b) => b!.y)).toBeLessThan(
    await page
      .locator('.trip-line')
      .boundingBox()
      .then((b) => b!.y),
  );
  await expect(page.locator('.trip-line .station.missed')).toHaveCount(0);

  await page.unroute(/\/trip$/);
  await page.route(/\/trip$/, (r) => r.fulfill({ contentType: 'application/xml', body: answer() }));
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('Showing the trains and times')).toBeHidden();
  await expect(page.locator('main')).toContainText(/\d+ stops?/);
});

test('a link cut off by a messenger says so', async ({ page }) => {
  await page.goto('./#/s/abc');
  await expect(page.getByRole('alert')).toContainText('a messenger cut it off');
  await page.goto('./#/j/AAAA');
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('a messenger cut it off');
});

test('reload from the menu: up to date; a train gone is said, and failing changes nothing', async ({
  page,
}) => {
  await page.clock.install({ time: BEFORE });
  const answer = recordAnswers(page);
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'T5 reload' }));
  const reload = async () => {
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: 'Reload trip' }).click();
  };

  await page.route(/\/trip$/, (r) => r.fulfill({ contentType: 'application/xml', body: answer() }));
  await reload();
  await expect(page.getByRole('status').filter({ hasText: 'Up to date' })).toBeAttached();

  await page.unroute(/\/trip$/);
  await page.route(/\/trip$/, (r) => r.abort());
  await reload();
  await expect(page.getByRole('status').filter({ hasText: 'Could not update' })).toBeAttached();
  await expect(page.locator('.hero-times')).toContainText('09:04');

  await page.unroute(/\/trip$/);
  await page.route(/\/trip$/, (r) =>
    r.fulfill({
      contentType: 'application/xml',
      body: '<OJP><OJPResponse><ServiceDelivery><OJPTripDelivery><ErrorCondition><TripProblemType>TRIP_NOTRIPFOUND</TripProblemType></ErrorCondition></OJPTripDelivery></ServiceDelivery></OJPResponse></OJP>',
    }),
  );
  await reload();
  await expect(page.getByText('is no longer in the timetable').first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('is no longer in the timetable').first()).toBeVisible();
});

test('pull down from the top reloads the trip; from further down it does not', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'touch');
  await page.clock.install({ time: BEFORE });
  const answer = recordAnswers(page);
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'T5 pull' }));
  let asked = 0;
  await page.route(/\/trip$/, (r) => {
    asked++;
    return r.fulfill({ contentType: 'application/xml', body: answer() });
  });
  const pull = (from: number, to: number, x = 180) =>
    page.evaluate(
      ({ from, to, x }) => {
        const el = document.querySelector('main')!;
        const at = (y: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
        const fire = (type: string, list: Touch[]) =>
          el.dispatchEvent(
            new TouchEvent(type, { bubbles: true, touches: list, changedTouches: [at(to)] }),
          );
        fire('touchstart', [at(from)]);
        for (let y = from; y <= to; y += 20) fire('touchmove', [at(y)]);
        fire('touchend', []);
      },
      { from, to, x },
    );

  await pull(200, 260);
  await page.waitForTimeout(100);
  expect(asked, 'a short pull does nothing').toBe(0);

  await pull(200, 400);
  await expect(page.getByRole('status').filter({ hasText: 'Up to date' })).toBeAttached();
  expect(asked).toBeGreaterThan(0);
  expect(
    await page.evaluate(() => document.documentElement.classList.contains('pull-reload')),
  ).toBe(true);

  const before = asked;
  await page.evaluate(() => {
    document.body.style.minHeight = '3000px';
    window.scrollTo(0, 300);
  });
  await pull(200, 400);
  await page.waitForTimeout(100);
  expect(asked, 'scrolled down, a pull is a scroll').toBe(before);
});

test('a via on the ride is one of its stops, in white; a station missed keeps the rail straight', async ({
  page,
}) => {
  const st = (name: string) => ({ stopRef: ref(name), name });
  const tour = {
    ...addWaypoint(
      addWaypoint(addWaypoint(newTour('v', DATE, st('St. Gallen')), st('Wattwil')), st('Bern')),
      st('Luzern'),
    ),
    name: 'Via on the ride',
  };
  const c = conn(
    ride('IR 1', [
      ['St. Gallen', '12:05'],
      ['Herisau', '12:13'],
      ['Wattwil', '12:32'],
      ['Uznach', '12:43'],
      ['Luzern', '14:21'],
    ]),
  );
  const chain = { connections: [c], warnings: [], score: 0, dep: c.dep, arr: c.arr };
  await page.clock.install({ time: BEFORE });
  await page.goto(
    `./${await encodeTrip(newTrip('v', tour, expandLegs(tour), chain, new Date(0)))}`,
  );
  await page.getByRole('button', { name: 'Save trip' }).click();
  await expect(page).toHaveURL(/#\/trip\//);

  const line = page.getByRole('list', { name: 'The trip' });
  const ride1 = line.locator('.ride').first();
  // Closed: the via alone, at the top of the ride; never a row of its own after it.
  await expect(ride1.locator('.mids li')).toHaveText([/12:32\s*Wattwil/]);
  await expect(line.locator('> li.station', { hasText: 'Wattwil' })).toHaveCount(0);
  const ink = await page.evaluate(() => getComputedStyle(document.body).color);
  await expect(ride1.locator('.mids .via .n')).toHaveCSS('color', ink);

  // Open: every stop in its place, the via once.
  await ride1.getByRole('button', { name: '3 stops' }).click();
  await expect(ride1.locator('.mids li')).toHaveText([/Herisau/, /Wattwil/, /Uznach/]);

  // It opens the panel like any station of yours.
  await ride1.locator('.via button.m').click();
  await expect(page.getByRole('button', { name: 'No stop' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Two choices: a change is the timetable's business, not one to pick.
  await expect(page.getByRole('group', { name: 'At this station' }).getByRole('button')).toHaveText(
    ['No stop', 'Stay'],
  );
  await ride1.locator('.via button.m').click();

  // Missed: its rail runs on the line, not beside it.
  const x = (sel: string) =>
    line
      .locator(sel)
      .first()
      .locator('> .rail')
      .evaluate((el) => el.getBoundingClientRect().left);
  await expect(line.locator('.station.missed')).toHaveText(/Bern/);
  expect(await x('.station.missed')).toBe(await x('.ride'));
});

test('a stop of 0 min, from a replan or an older trip, reads as no stop', async ({ page }) => {
  const st = (name: string) => ({ stopRef: ref(name), name });
  const tour = {
    ...setEntryStay(
      addWaypoint(addWaypoint(newTour('z', DATE, st('St. Gallen')), st('Wattwil')), st('Luzern')),
      1,
      0,
    ),
    name: 'Zero stop',
  };
  const a = conn(
    ride('IR 1', [
      ['St. Gallen', '12:05'],
      ['Wattwil', '12:32'],
    ]),
  );
  const b = conn(
    ride('IR 2', [
      ['Wattwil', '12:40'],
      ['Luzern', '14:21'],
    ]),
  );
  const chain = { connections: [a, b], warnings: [], score: 0, dep: a.dep, arr: b.arr };
  await page.clock.install({ time: BEFORE });
  await page.goto(
    `./${await encodeTrip(newTrip('z', tour, expandLegs(tour), chain, new Date(0)))}`,
  );
  await page.getByRole('button', { name: 'Save trip' }).click();
  await expect(page).toHaveURL(/#\/trip\//);
  await page
    .locator('.trip-line .station.entry', { hasText: 'Wattwil' })
    .locator('button.m')
    .click();
  const choice = page.getByRole('group', { name: 'At this station' });
  await expect(choice.getByRole('button', { name: 'No stop' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(choice.getByRole('button', { name: 'Stay' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});
