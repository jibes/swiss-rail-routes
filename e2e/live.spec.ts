import { encodeTour } from '../tests/helpers/share';
import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { BEFORE, expect, pick, planShared, test } from './fixtures';

// T5 (Interlaken Ost 09:04 → Kleine Scheidegg), lived through with a controlled clock.
// Live calls (/journey) are not recorded: the screen falls back to timetable times.
test('a trip under way: next step, progress, the marker on the line', async ({ page }) => {
  await page.clock.install({ time: new Date(`${FIXTURE_DATE}T07:50:00Z`) }); // 08:50 in Zürich
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'T5' }));

  // Before departure.
  await expect(page.getByText('Departure', { exact: true })).toBeVisible();
  await expect(page.getByText('in 14 min')).toBeVisible();
  await expect(page.locator('.trip-line .station.here')).toHaveCount(1);
  // Not left yet: another connection can still be taken.
  await expect(page.getByRole('group', { name: 'Alternatives' })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  // 09:03:30, the train in half a minute: nothing leaves before it from now, so Earlier finds
  // none and the trip stays as it is (choosing a connection gone would end it at once).
  await page.clock.runFor('13:30');
  const hero = await page.locator('.next-time .num').innerText();
  await page.getByRole('button', { name: 'Earlier connections' }).click();
  await expect(page.locator('.options-note')).toHaveText('No earlier connection on this day.');
  await expect(page.locator('.next-time .num')).toHaveText(hero);
  await expect(page.locator('.trip-line .station.here')).toHaveCount(1);

  // On the train: the marker rides along, its stops open, passed ones grey.
  await page.clock.runFor('11:30');
  await expect(page.getByText(/Get off at Lauterbrunnen|Get off at Grindelwald/)).toBeVisible();
  await expect(page.locator('.trip-line .ride.here')).toHaveCount(1);
  await expect(page.getByRole('group', { name: 'Alternatives' })).toHaveCount(0);
  // Under way the route is not turned round: the line changes what lies ahead.
  await page.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('button', { name: 'Duplicate' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reverse direction' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.trip-line .ride.here .mids li').first()).toBeVisible();
  await expect(page.locator('.here-mid')).toHaveCount(1);
  await expect(page.locator('.here-mid')).toHaveText('You are here');
  // The marker sits on the rail between the stop before and the one after it.
  const marker = await page.evaluate(() => {
    const row = document.querySelector('.trip-line .ride.here')!;
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
  await expect(page.locator('.trip-line.live .passed').first()).toBeVisible();
  expect(Number(await page.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeGreaterThan(
    0,
  );

  // The lists show the live bar; opening the app goes straight to Now.
  await page.goto('./#/trips');
  await expect(page.locator('.livebar')).toBeVisible();
  await page.goto('./');
  await expect(page).toHaveURL(/#\/trip\/[\w-]+$/);
  // A reload stays where it was (only opening the app goes to the trip under way).
  await page.goto('./#/trips');
  await page.goto('./#/');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Under way');
});

test('under way, what lies ahead is changed on the line itself: a stop, update, undo', async ({
  page,
}) => {
  await page.clock.install({ time: new Date(`${FIXTURE_DATE}T07:50:00Z`) }); // planned at 08:50
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'T5' }));
  // 09:15, on the R62 (a trip is never planned from a time gone).
  await page.clock.runFor('25:00');
  const line = page.getByRole('list', { name: 'The trip', exact: true });
  // One screen (0.46.0): no separate Replan from here. Behind you nothing opens; a station
  // ahead begins changing the rest, on the same screen.
  await expect(page.getByRole('link', { name: 'Replan from here' })).toHaveCount(0);
  await line.locator('.station', { hasText: 'Kleine Scheidegg' }).locator('button.m').click();
  await expect(page).toHaveURL(/#\/trip\/[\w-]+$/);
  // The rest from here is planned at once, without a failure first.
  await expect(page.getByRole('button', { name: 'Update trip' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  // Nothing changed yet: nothing to update. The way here, grey, above the rest.
  await expect(page.getByRole('button', { name: 'Update trip' })).toBeDisabled();
  await expect(page.locator('.trip-line.past .ride')).toHaveCount(1);
  await expect(page.locator('.trip-line.past .station')).toHaveText([/Interlaken Ost/]);
  // Discard: back as it was.
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByRole('button', { name: 'Update trip' })).toHaveCount(0);
  await expect(page.locator('.trip-line.past')).toHaveCount(0);

  // Again, by adding: where you are is fixed, only "Add after".
  await line.locator('.station', { hasText: 'Kleine Scheidegg' }).locator('button.m').click();
  await line.locator('.station.entry').first().getByRole('button').first().click();
  await expect(page.getByRole('combobox', { name: 'Station' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add after' }).click();
  await pick(page, 'Wengen');

  const wengen = line.locator('.station.entry', { hasText: 'Wengen' });
  await wengen.getByRole('button', { name: /^Wengen/ }).click();
  await page.getByRole('button', { name: 'Stay', exact: true }).click();
  // Planned as you edit: no Find button, Update once the plan is there.
  await expect(page.getByRole('button', { name: 'Find connections' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Update trip' })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Update trip' }).click({ timeout: 30_000 });

  // The trip under way again: the new plan (via Wengen), undo available.
  await expect(page.getByRole('button', { name: 'Update trip' })).toHaveCount(0);
  await expect(line.locator('.station.entry', { hasText: 'Wengen' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo last change' }).click();
  // No Wengen station any more (the GA note still names its stretch, Wengen–Kleine Scheidegg).
  await expect(line.locator('.station', { hasText: 'Wengen' })).toHaveCount(0);
  await expect(line.locator('.station', { hasText: 'Kleine Scheidegg' })).toHaveCount(1);
});

test('before departure: edited in place; after its day: in search', async ({ page }) => {
  await page.clock.install({ time: new Date(`${FIXTURE_DATE}T05:00:00Z`) }); // 06:00, hours before
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'T5' }));

  // Before departure: the timetable, every station a button for the panel; nothing live.
  await expect(page.locator('.hero-times')).toContainText('09:04');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.locator('.trip-line .station.entry').first().getByRole('button').first().click();
  await expect(page.getByRole('button', { name: 'Add after' })).toBeVisible();
  await page.goto('./');
  await expect(page.getByRole('list', { name: 'Upcoming' }).getByRole('link')).toHaveCount(1);

  // The day after: gone from the list, T5 waits in search.
  await page.clock.setSystemTime(new Date(`2026-11-08T08:00:00Z`));
  await page.reload();
  await expect(page.getByRole('list', { name: 'Upcoming' })).toHaveCount(0);
  await page.getByRole('button', { name: 'New trip' }).click();
  await expect(page.getByRole('button', { name: /^T5/ })).toBeVisible();
});

// T3 walks at Interlaken Ost and Thun: once passed, the stations beside a walk are grey all
// along their rail, not red where it is solid (they were, as fragments on the grey line).
test('under way, the stations beside a walk passed are grey', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T3!, name: 'T3' }));
  const [, arr] = (await page.locator('.hero-times').innerText()).match(/\d\d:\d\d/g)!;
  const end = Date.parse(`${FIXTURE_DATE}T${arr}:00+01:00`);
  await page.clock.fastForward(end - 20 * 60_000 - BEFORE.getTime());
  await expect(page.locator('.trip-line.live')).toBeVisible();
  const passed = page.locator('.trip-line.live .station.passed:is(.walk-from, .walk-to)');
  await expect(passed.first()).toBeVisible();
  const red = await passed.evaluateAll((els) => {
    const probe = document.createElement('i');
    probe.style.color = 'var(--rail)';
    document.body.append(probe);
    const rail = getComputedStyle(probe).color;
    probe.remove();
    return els.filter((li) =>
      getComputedStyle(li.querySelector('.rail')!, '::before').backgroundImage.includes(rail),
    ).length;
  });
  expect(red).toBe(0);
  // Each walk is one dotted line from the dot before to the dot after (drawn in pieces, the
  // dots bunched where rows met), also with a station's note open above it.
  const spans = () =>
    page.locator('.trip-line > li.ride.walk').evaluateAll((walks) =>
      walks.map((w) => {
        const rail = w.querySelector(':scope > .rail')!;
        const line = getComputedStyle(rail, '::before');
        const box = rail.getBoundingClientRect();
        const centre = (li: Element | null) => {
          const b = li!.querySelector('.dot')!.getBoundingClientRect();
          return b.top + b.height / 2;
        };
        const top = box.top + parseFloat(line.top);
        const bottom = box.top + parseFloat(line.top) + parseFloat(line.height);
        return [
          Math.abs(top - centre(w.previousElementSibling)) < 1.5,
          Math.abs(bottom - centre(w.nextElementSibling)) < 1.5,
        ];
      }),
    );
  expect((await spans()).flat().every(Boolean)).toBe(true);
  // A station the timetable added, beside a walk: a tap opens its note, the row grows.
  const added = page.locator('.trip-line .station.auto.walk-from');
  await added.locator('.m.locked').first().click();
  await expect(added.first().locator('.plan-panel')).toBeVisible();
  expect((await spans()).flat().every(Boolean)).toBe(true);
});

// The train reports another platform than the planned one: the line says so, both platforms.
test('a platform changed on the day shows on the line', async ({ page }) => {
  await page.clock.install({ time: new Date(`${FIXTURE_DATE}T07:50:00Z`) }); // 08:50 in Zürich
  const quay = (p: string) => `<Text xml:lang="de">${p}</Text>`;
  await page.route(/\/journey$/, (route) =>
    route.fulfill({
      contentType: 'application/xml',
      body:
        '<?xml version="1.0" encoding="utf-8"?><OJP xmlns:siri="http://www.siri.org.uk/siri" xmlns="http://www.vdv.de/ojp"><OJPResponse><siri:ServiceDelivery><OJPTripInfoDelivery><TripInfoResult>' +
        '<OnwardCall><siri:StopPointRef>ch:1:sloid:7492:0:94927</siri:StopPointRef><StopPointName>' +
        quay('Interlaken Ost') +
        `</StopPointName><PlannedQuay>${quay('2A')}</PlannedQuay><EstimatedQuay>${quay('3')}</EstimatedQuay>` +
        `<ServiceDeparture><TimetabledTime>${FIXTURE_DATE}T08:04:00Z</TimetabledTime></ServiceDeparture></OnwardCall>` +
        '</TripInfoResult></OJPTripInfoDelivery></siri:ServiceDelivery></OJPResponse></OJP>',
    }),
  );
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'T5' }));
  const moved = page.locator('.trip-line .ride .platform-moved').first();
  await expect(moved).toBeVisible();
  await expect(moved.locator('s')).toHaveText('Pl. 2A');
  await expect(moved.locator('b')).toHaveText('Pl. 3');
  await expect(moved.locator('.sr-only')).toHaveText('Platform changed: now 3, was 2A');
});

test('a delay is the timetable time and how late, never the expected time again', async ({
  page,
}) => {
  await page.clock.install({ time: new Date(`${FIXTURE_DATE}T07:50:00Z`) }); // 08:50 in Zürich
  await page.route(/\/journey$/, (route) =>
    route.fulfill({
      contentType: 'application/xml',
      body:
        '<?xml version="1.0" encoding="utf-8"?><OJP xmlns:siri="http://www.siri.org.uk/siri" xmlns="http://www.vdv.de/ojp"><OJPResponse><siri:ServiceDelivery><OJPTripInfoDelivery><TripInfoResult>' +
        '<OnwardCall><siri:StopPointRef>ch:1:sloid:7492:0:94927</siri:StopPointRef><StopPointName><Text xml:lang="de">Interlaken Ost</Text></StopPointName>' +
        `<ServiceDeparture><TimetabledTime>${FIXTURE_DATE}T08:04:00Z</TimetabledTime><EstimatedTime>${FIXTURE_DATE}T08:06:00Z</EstimatedTime></ServiceDeparture></OnwardCall>` +
        '</TripInfoResult></OJPTripInfoDelivery></siri:ServiceDelivery></OJPResponse></OJP>',
    }),
  );
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'T5' }));
  // Reported, 0.40.0: "17:56 +1" for a train planned at 17:55.
  const start = page.locator('.trip-line .station').first().locator('time').first();
  await expect(start).toHaveText(/^09:04 \+2/);
});

// At a station mid-trip (a stay), the rail is the way here down to its dot and ahead below it,
// as on a ride: the grey/red split sat at the top of the row (reported on Melide, 5 Nov 2026).
test('under way at a stay, the rail splits at the station’s dot', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T3!, name: 'T3' }));
  const here = page.locator('.trip-line.live > li.station.here:not(:first-child)');
  const [dep] = (await page.locator('.hero-times').innerText()).match(/\d\d:\d\d/g)!;
  await page.clock.fastForward(Date.parse(`${FIXTURE_DATE}T${dep}:00+01:00`) - BEFORE.getTime());
  for (let i = 0; i < 80 && !(await here.count()); i++) await page.clock.fastForward(5 * 60_000);
  await expect(here.first()).toBeVisible();
  const split = await here.first().evaluate((li) => {
    const rail = li.querySelector(':scope > .rail')!;
    const line = getComputedStyle(rail, '::before');
    const dot = (li.querySelector('.rail .dot') ?? rail).getBoundingClientRect();
    const top = rail.getBoundingClientRect().top + parseFloat(line.top);
    const stops = [...line.backgroundImage.matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1]));
    return {
      image: line.backgroundImage,
      at: stops.find((x) => x > 0),
      dot: dot.top + dot.height / 2 - top,
    };
  });
  expect(split.image).toContain('linear-gradient');
  expect(split.at, split.image).toBeDefined();
  expect(Math.abs(split.at! - split.dot)).toBeLessThan(1.5);
});

// In a ride's stop list a delay stays beside its time, for a route station (a via row) as for
// any other stop: on via rows "+1" wrapped under the time (reported 5 Nov 2026).
test('a delay in a stop list stays on the time’s line, via rows included', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T1!, name: 'T1' }));
  for (const toggle of await page.locator('.trip-line .ride .mids-toggle').all())
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  await expect(page.locator('.trip-line .ride .mids li.via').first()).toBeVisible();
  const rows = await page.locator('.trip-line .ride .mids li:not(.here-mid)').evaluateAll((lis) =>
    lis.flatMap((li) => {
      const time = li.querySelector('time');
      if (!time) return [];
      const late = document.createElement('span');
      late.className = 'late';
      late.textContent = ' +12';
      time.append(late);
      const t = time.getBoundingClientRect();
      const n = (li.querySelector('.n') ??
        li.querySelector('.mid-name') ??
        li.querySelector('span:not(.late)'))!.getBoundingClientRect();
      return [
        {
          via: li.classList.contains('via'),
          oneLine: t.height < 24,
          beside: n.left >= t.right - 1,
        },
      ];
    }),
  );
  expect(rows.some((r) => r.via)).toBe(true);
  expect(rows.filter((r) => !r.oneLine || !r.beside)).toEqual([]);
});
