import AxeBuilder from '@axe-core/playwright';
import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { encodeTour } from '../tests/helpers/share';
import { allowUnrecorded, BEFORE, expect, newTrip, pick, planShared, test } from './fixtures';

test('one line: stations, a scenic line as rings, the panel, a round trip, kept after reload', async ({
  page,
}) => {
  await page.clock.install({ time: BEFORE });
  // These trips are about editing, not planning: nothing is recorded for them.
  allowUnrecorded(page);
  await newTrip(page, 'zürich hb', 'luzern');
  await page.getByRole('button', { name: 'Add a station' }).click();
  // A scenic line from where you are: its end station is yours, the stations between are rings.
  await pick(page, 'brünig', /^Brünig.*Luzern → Interlaken Ost/);
  await page.getByRole('button', { name: 'Add a station' }).click();
  await page.getByRole('button', { name: /^Back to Zürich HB/ }).click();

  const line = page.getByRole('list', { name: 'The trip' });
  const entries = line.locator('.station.entry');
  await expect(entries).toHaveText([/^Zürich HB/, /^Luzern/, /^Interlaken Ost/, /^Zürich HB/]);
  await expect(line.locator('.station.ring').first()).toBeVisible();
  // Grey is the line's: a tap opens its card, saying why it is not editable, and no editing.
  await line.locator('.station.ring button').first().click();
  await expect(page.locator('.plan-panel').getByText(/Part of the Brünig line/)).toBeVisible();
  await expect(page.locator('.panel:not(.plan-panel)')).toHaveCount(0);
  await page.locator('.plan-panel').getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.panel')).toHaveCount(0);

  // The panel: what you do there, the line that leads there, add after, up, down, remove.
  await entries.nth(1).getByRole('button').first().click();
  // Stay: 30 min at first, then a quarter hour more with +, or any number typed.
  await page
    .getByRole('group', { name: 'At this station' })
    .getByRole('button', { name: 'Stay', exact: true })
    .click();
  await expect(entries.nth(1)).toContainText('Stay 30 min');
  await page.getByRole('button', { name: '15 min longer' }).click();
  await expect(entries.nth(1)).toContainText('Stay 45 min');
  const minutes = page.getByRole('spinbutton', { name: /^Minutes at/ });
  await minutes.fill('60');
  await minutes.press('Enter');
  await expect(entries.nth(1)).toContainText('Stay 60 min');
  await entries.nth(2).getByRole('button').first().click();
  await expect(page.getByText('Via Brünig')).toBeVisible();
  // The panel's cross closes it (the name's own Clear shows only while another is typed).
  await expect(page.locator('.panel').getByRole('button', { name: 'Clear' })).toHaveCount(0);
  await page.locator('.panel').getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.panel')).toHaveCount(0);
  await entries.nth(2).getByRole('button').first().click();
  const blocking = (await new AxeBuilder({ page }).analyze()).violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);

  // Moving Interlaken Ost up takes the Brünig line away (its two ends are no longer neighbours).
  await page.getByRole('button', { name: 'Move Interlaken Ost up' }).click();
  await expect(entries).toHaveText([/^Zürich HB/, /^Interlaken Ost/, /^Luzern/, /^Zürich HB/]);
  // Focus stays in its panel, not on the page (review, 0.53.0).
  await expect(page.locator('.panel :focus')).toHaveCount(1);
  await expect(line.locator('.station.ring')).toHaveCount(0);
  // A station between your first and last is removed as any (0.59.0: no pins).
  await page.getByRole('button', { name: 'Remove Interlaken Ost' }).click();
  await expect(entries).toHaveCount(3);

  // The panel names its station, it does not rename it (0.35.1: add another, remove this one).
  await entries.nth(1).getByRole('button').first().click();
  await expect(page.getByRole('combobox', { name: 'Station' })).toHaveCount(0);
  await expect(page.locator('.panel .panel-name')).toHaveText('Luzern');
  await expect(entries.nth(1)).toContainText('Stay 60 min');

  await page.reload();
  await expect(entries).toHaveText([/^Zürich HB/, /^Luzern/, /^Zürich HB/]);
});

test('drag the open station by its grip; rename the trip', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  // These trips are about editing, not planning: nothing is recorded for them.
  allowUnrecorded(page);
  await newTrip(page, 'Bern', 'Thun', 'Spiez', 'Brig');
  const entries = page.locator('.trip-line .station.entry');
  await expect(entries).toHaveText([/^Bern/, /^Thun/, /^Spiez/, /^Brig/]);
  // Nothing recorded for this trip: its planning ends in a notice above the line. Wait for it,
  // so the line does not move under the pointer.
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 });
  await entries.nth(3).getByRole('button').first().click();
  const grip = page.getByRole('button', { name: 'Drag to move Brig' });
  const from = (await grip.boundingBox())!;
  const to = (await entries.nth(1).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, to.y + 4, { steps: 12 });
  await page.mouse.up();
  await expect(entries).toHaveText([/^Bern/, /^Brig/, /^Thun/, /^Spiez/]);

  await page.locator('h1 .title').click();
  const name = page.getByRole('textbox', { name: 'Name' });
  await name.fill('Lötschberg day');
  await name.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lötschberg day');
});

test('an edit survives a reload right after it', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  await newTrip(page, 'Bern');
  // A name waits 300 ms to be saved; the page goes before that.
  await page.locator('h1 .title').click();
  const name = page.getByRole('textbox', { name: 'Name' });
  await name.fill('Lötschberg day');
  await name.press('Enter');
  await page.reload();
  await expect(page.locator('h1 .title')).toHaveText('Lötschberg day');
  // Taken into the list, it is gone from where the page left it.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('srr.unsaved.trips.v1')))
    .toBeNull();
  // A station is saved at once, and the page may still go during the write.
  await page.getByRole('button', { name: 'Add a station' }).click();
  await pick(page, 'Thun');
  await expect(page.locator('.trip-line .station.entry').nth(1)).toContainText('Thun');
  await page.reload();
  await expect(page.locator('.trip-line .station.entry')).toHaveText([/^Bern/, /^Thun/]);
});

// One object (0.52.0): a trip over stays a trip, folded under Past trips and edited as any
// other; its stations are offered again when adding.
test('a trip over stays a trip: in past trips, editable, its stations offered again', async ({
  page,
}) => {
  await page.clock.install({ time: BEFORE });
  allowUnrecorded(page);
  await newTrip(page, 'Chur', 'Arosa');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('link', { name: /Chur → Arosa/ })).toBeVisible();

  // The Sunday after: no longer ahead, folded under Past trips.
  await page.clock.setSystemTime(new Date('2026-11-08T08:00:00Z'));
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nothing planned');
  await expect(page.getByRole('link', { name: /Chur → Arosa/ })).toBeHidden();
  await page.getByText('Past trips (1)').click();
  await page.getByRole('link', { name: /Chur → Arosa/ }).click();
  // Edited as any other: its date and its stations.
  await expect(page.getByLabel('Date')).toHaveValue('2026-11-02');
  await page.locator('.trip-line .station.entry').first().getByRole('button').first().click();
  await expect(page.getByRole('button', { name: 'Add after' })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();

  // A new trip: the stations you entered first, your trips folded under them.
  await page.getByRole('button', { name: 'New trip' }).click();
  const sheet = page.locator('.add-sheet');
  await expect(sheet.locator('.result.recent')).toHaveText([/^Arosa/, /^Chur/]);
  await page.getByRole('heading', { name: 'Past trips' }).click();
  await page.getByRole('button', { name: /^Chur → Arosa/ }).click();
  await expect(page.locator('.trip-line .station.entry')).toHaveText([/^Chur/, /^Arosa/]);
  await expect(page.getByLabel('Date')).toHaveValue('2026-11-08');
});

test('delete at once, with Undo for a few seconds', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  await newTrip(page, 'Chur', 'Arosa');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Delete trip' }).click();

  // Back on the list without it; Undo brings it back as it was.
  const card = page.getByRole('link', { name: /Chur → Arosa/ });
  await expect(card).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(card).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);

  // Without Undo it stays gone, and the note goes after a few seconds.
  await card.click();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Delete trip' }).click();
  await expect(page.getByText('Deleted: Chur → Arosa')).toBeVisible();
  await page.clock.runFor(11_000);
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  await page.reload();
  await expect(card).toHaveCount(0);
});

test('Escape closes what is on top first; renaming cancels; /edit before departure is the trip', async ({
  page,
}) => {
  await page.clock.install({ time: BEFORE });
  // These trips are about editing, not planning: nothing is recorded for them.
  allowUnrecorded(page);
  await newTrip(page, 'Bern', 'Thun');
  const entries = page.locator('.trip-line .station.entry');
  await entries.first().getByRole('button').first().click();
  await expect(page.locator('.panel')).toBeVisible();
  await page.getByRole('button', { name: 'More' }).click();
  await expect(page.locator('.menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu')).toHaveCount(0);
  await expect(page.locator('.panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.panel')).toHaveCount(0);

  await page.locator('h1 .title').click();
  const name = page.getByRole('textbox', { name: 'Name' });
  await name.fill('Changed my mind');
  await name.press('Escape');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bern → Thun');

  // The old whole-trip editor (with its ticket choice) is gone before departure.
  await page.goto(page.url() + '/edit');
  await expect(page.locator('.trip-line')).toBeVisible();
  await expect(page.getByText('Ticket', { exact: true })).toHaveCount(0);
});

test('search: a line typed by its name comes first, a station named so stays first; stops say what they are', async ({
  page,
}) => {
  await page.clock.install({ time: BEFORE });
  await newTrip(page);
  const search = page.getByPlaceholder('Station, scenic line or past trip');
  const first = page.locator('.add-sheet .results .result').first();
  await search.fill('Bernina');
  await expect(first).toContainText('St. Moritz → Tirano');
  await search.fill('Bern');
  await expect(first).toHaveText('Bern');
  // A named train finds the lines on its route (round 3: "Glacier Express" found nothing);
  // a station's name in another language finds the station ("Ginevra").
  await search.fill('Glacier Express');
  await expect(page.locator('.add-sheet .result .r-line')).toHaveCount(2);
  await expect(page.locator('.add-sheet .results')).toContainText('Oberalp');
  await expect(page.locator('.add-sheet .results')).toContainText('Albula');
  await search.fill('Ginevra');
  await expect(first).toHaveText('Genève');
  // A bus stop is said to be one.
  await search.fill('Bernina Suot, Bahnhof');
  await expect(
    page.locator('.add-sheet .result', { hasText: /^Bernina Suot, Bahnhof/ }),
  ).toContainText('Bus stop');
  await search.fill('Bern');
  await search.press('Enter');
  await expect(page.locator('.trip-line .station.entry').first()).toContainText('Bern');
  await expect(page.locator('.trip-line .station.entry').first()).not.toContainText('Bernina');
});

// One row (0.51.0): how long and until when, each filled from the other; the one set last kept.
test('a stay as length or until: either sets it, kept after reload', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  allowUnrecorded(page);
  await newTrip(page, 'zürich hb', 'luzern', 'bern');
  const entries = page.getByRole('list', { name: 'The trip' }).locator('.station.entry');
  await entries.nth(1).getByRole('button').first().click();
  // Only a stay has a length and an end; no time to leave by any more.
  await expect(page.locator('.panel .stay-row')).toHaveCount(0);
  await page
    .getByRole('group', { name: 'At this station' })
    .getByRole('button', { name: 'Stay', exact: true })
    .click();
  const row = page.getByRole('group', { name: 'Stay at Luzern' });
  await expect(row.getByLabel('Minutes at Luzern')).toHaveValue('30');
  await expect(page.getByLabel(/Leave Luzern by/)).toHaveCount(0);
  const until = row.getByLabel('Stay at Luzern until (time)');
  await until.fill('17:30');
  await until.press('Enter');
  // The line says the time; the day only when it is not the arrival's.
  await expect(entries.nth(1)).toContainText('Stay until 17:30');
  await expect(row.locator('.stay-end')).not.toHaveClass(/derived/);
  await expect(row.locator('.stepper')).toHaveClass(/derived/);

  await page.reload();
  await expect(entries.nth(1)).toContainText('Stay until 17:30');
  await entries.nth(1).getByRole('button').first().click();
  // A length typed is kept instead: the time goes.
  const minutes = row.getByLabel('Minutes at Luzern');
  await minutes.fill('45');
  await minutes.press('Enter');
  await expect(entries.nth(1)).toContainText('Stay 45 min');
  await expect(row.locator('.stepper')).not.toHaveClass(/derived/);
  // Riding through, both go with the stay.
  await page
    .getByRole('group', { name: 'At this station' })
    .getByRole('button', { name: 'No stop' })
    .click();
  await expect(page.locator('.panel .stay-row')).toHaveCount(0);
});

// Reported on the MCP (5 Nov 2026): "Swissminiatur" found only its pier. A place people go to
// is found by its name and adds the stop nearest it, the walk said.
test('a place found by its name adds its stop', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'New trip' }).click();
  await page.getByPlaceholder('Station, scenic line or past trip').fill('Swissminiatur');
  const place = page.getByRole('button', {
    // A walk known (curated) is said as known, not as about (review of 11 Nov 2026).
    name: /^Swissminiatur Melide · 4 min on foot$/,
  });
  await expect(page.getByRole('heading', { name: 'Places' })).toBeVisible();
  await place.click();
  await expect(page.locator('.trip-line .station', { hasText: 'Melide' })).toBeVisible();
});

// Off the train at a station (0.42.0): from the dot down to the next train the rail is dotted, as
// a walk is: at every change and stay; a station ridden through stays solid.
test('the rail is dotted wherever you are off the train', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T1!, name: 'Off' }));
  const line = page.getByRole('list', { name: 'The trip', exact: true });
  await expect(
    line
      .locator(':scope > li.station')
      .filter({ has: page.locator('.n', { hasText: /^Chur/ }) })
      .locator('.offtrain'),
  ).toHaveCount(1, {
    timeout: 15_000,
  });
  await expect(
    line
      .locator(':scope > li.station')
      .filter({ has: page.locator('.n', { hasText: /^Alp Grüm/ }) })
      .locator('.offtrain'),
  ).toHaveCount(1);
  // Two dots (0.45.1): the arrival's with its time, the departure's at the row's foot with its.
  const chur = line
    .locator(':scope > li.station')
    .filter({ has: page.locator('.n', { hasText: /^Chur/ }) });
  await expect(chur.locator('.dot')).toHaveCount(2);
  await expect(chur.locator(':scope > .t').first()).toContainText('09:52');
  await expect(chur.locator('.t-dep')).toContainText('09:58');
  // The station named beside both (0.49.1), the second at the departure's dot.
  await expect(chur.locator('.n-dep')).toHaveText(/^ChurPl\. \w+$/);
  const mid = async (l: import('@playwright/test').Locator) => {
    const b = (await l.boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const depDot = await mid(chur.locator('.dep-dot'));
  expect(Math.abs((await mid(chur.locator('.n-dep'))).y - depDot.y)).toBeLessThan(4);
  // A change at a station the plan chose (smaller dots): the second dot on the rail as the first
  // (reported: it sat 2 px off, drawn with the big dot's offset).
  const sagliains = line
    .locator(':scope > li.station')
    .filter({ has: page.locator('.n', { hasText: /^Sagliains/ }) });
  const dots = sagliains.locator('.rail .dot');
  await expect(dots).toHaveCount(2);
  const [a, b] = [await mid(dots.nth(0)), await mid(dots.nth(1))];
  expect(Math.abs(a.x - b.x)).toBeLessThan(0.5);
  expect((await dots.nth(0).boundingBox())!.width).toBe((await dots.nth(1).boundingBox())!.width);
  await expect(sagliains.locator('.n-dep')).toContainText('Sagliains');
  // A ride's two rows, the same split on every ride (0.49.1): the train, where it goes and its
  // platform on one line; its stops, duration and notes below, the stops first.
  const firstRows = line.locator('.ride .ride-l1');
  const n = await firstRows.count();
  expect(n).toBeGreaterThan(5);
  for (let k = 0; k < n; k++) {
    const h = (await firstRows.nth(k).boundingBox())!.height;
    expect(h, `ride ${k}: one line`).toBeLessThan(36);
    await expect(firstRows.nth(k).locator('.mids-toggle')).toHaveCount(0);
  }
  await expect(line.locator('.ride .ride-l2').first().locator('> :first-child')).toHaveClass(
    /mids-toggle/,
  );
  // Start and end: no train to wait between.
  await expect(line.locator(':scope > li.station').first().locator('.offtrain')).toHaveCount(0);
  await expect(line.locator(':scope > li.station').last().locator('.offtrain')).toHaveCount(0);

  // Nothing moves the page sideways (reported on 0.50.1: a long "→ Genève-Aéroport" left its
  // words for screen readers past the edge, and a finger panned the page to them).
  const sideways = await page.evaluate(() => {
    scrollTo(300, scrollY);
    // Clipped with the name: held by it, not by the page.
    const outside = [...document.querySelectorAll<HTMLElement>('.towards .sr-only')].filter(
      (sr) => !sr.offsetParent?.classList.contains('towards'),
    ).length;
    return { x: scrollX, outside };
  });
  expect(sideways).toEqual({ x: 0, outside: 0 });

  // Long waits at a change are said, and kinds in the app's language (review, 0.53.0).
  await expect(line.locator('.station .chip', { hasText: 'Wait 1h00' })).toHaveCount(1);
  await expect(line.locator('.product', { hasText: 'Replacement bus' }).first()).toBeVisible();
  await expect(line.locator('.product', { hasText: 'Ersatzverkehr' })).toHaveCount(0);

  // A stay's row (0.51.0): its end is the plan's arrival and its length, said beside it.
  const grum = line
    .locator(':scope > li.station.entry')
    .filter({ has: page.locator('.n', { hasText: /^Alp Grüm/ }) });
  const arr = (await grum.locator(':scope > .t').first().innerText()).match(/\d\d:\d\d/)![0];
  await grum.getByRole('button').first().click();
  const stay = page.getByRole('group', { name: 'Stay at Alp Grüm' });
  await expect(stay.getByLabel('Minutes at Alp Grüm')).toHaveValue('30');
  const [h, m] = arr.split(':').map(Number) as [number, number];
  const end = `${String(Math.floor((h * 60 + m + 30) / 60)).padStart(2, '0')}:${String((m + 30) % 60).padStart(2, '0')}`;
  await expect(stay.locator('.stay-end .when-field').first()).toContainText(end);
  await expect(stay.locator('.stay-end')).toHaveClass(/derived/);
});

// One trip per day of travel (0.64.0): a stay ends its day (no day to pick), a route kept over a
// night opens as one trip a day, and a new trip offers to start where the last one ends.
test('a night ends the trip: a link over a night is two trips; the next starts where it ended', async ({
  page,
}) => {
  await page.clock.install({ time: BEFORE });
  allowUnrecorded(page);
  // Chur → Arosa, a night there until 10:00 on the 9th, → Chur.
  await page.goto('./#/r/chur.9000~arosa.9157.30.n202611091000~chur.9000?d=2026-11-08');
  await page.getByRole('button', { name: 'Plan this trip' }).click();
  const line = page.getByRole('list', { name: 'The trip' });
  await expect(line.locator('.station.entry')).toHaveCount(2);
  await expect(line.locator('.station.entry').last()).toContainText('Arosa');
  // The stay at a station has a time on its day only.
  await line.locator('.station.entry').last().getByRole('button').first().click();
  await expect(page.getByLabel(/until \(day\)/)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.goto('./#/trips');
  const cards = page.getByRole('list', { name: 'Upcoming' }).getByRole('link');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(1)).toContainText('Arosa → Chur');

  // A new trip: from where the last one ends, the day after.
  await page.getByRole('button', { name: 'New trip' }).click();
  await page.getByRole('button', { name: /^From Chur/ }).click();
  await expect(line.locator('.station.entry').first()).toContainText('Chur');
  await expect(page.getByLabel('Date')).toHaveValue('2026-11-10');
});

// Notifications per trip (0.44.0): ⋯ turns them off and on again; the trip keeps it (synced).
test('notifications off for one trip, and on again', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  allowUnrecorded(page);
  await newTrip(page, 'zürich hb', 'bern');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Notifications off' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Notifications on' }).click();
  await page.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('button', { name: 'Notifications off' })).toBeVisible();
});

// Reported (0.47.1): a round trip in search said "Zürich → Zürich". Now named as the list names
// it, and a station picked is offered first next time, whichever trip it was for (0.48.0).
test('your trips say where they went; stations you entered come first', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  allowUnrecorded(page);
  await newTrip(page, 'chur', 'thusis', 'chur');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.clock.setSystemTime(new Date('2026-11-08T08:00:00Z'));
  await page.reload();
  await page.getByRole('button', { name: 'New trip' }).click();
  const sheet = page.locator('.add-sheet');
  await expect(sheet.locator('.result.recent').first()).toHaveText(/^Chur/);
  await page.getByRole('heading', { name: 'Past trips' }).click();
  await expect(sheet.locator('.result.trip .r-name')).toHaveText(['Chur ↺ Thusis']);
  // Picked once, first next time: typed and chosen, then offered at the top.
  await pick(page, 'Landquart');
  await page.getByRole('button', { name: 'Add a station' }).click();
  await expect(sheet.locator('.result.recent').first()).toHaveText(/^Chur/);
  await expect(sheet.locator('.result.recent')).not.toContainText(['Landquart']);
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'New trip' }).click();
  await expect(sheet.locator('.result.recent').first()).toHaveText(/^Landquart/);
});

// Reported in review (0.51.0): at 360 px the panel's own buttons ran past it, under the weather
// stripe. Every control of a stay's panel lies inside the panel.
test.describe('a small phone', () => {
  test.use({ viewport: { width: 360, height: 800 } });
  test('the station panel fits the line', async ({ page }) => {
    await page.clock.install({ time: BEFORE });
    await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T3!, name: 'T3' }));
    await page
      .getByRole('list', { name: 'The trip', exact: true })
      .locator('.station.entry')
      .filter({ has: page.locator('.n', { hasText: /^Luzern/ }) })
      .first()
      .getByRole('button')
      .first()
      .click();
    await expect(page.locator('.panel .stay-row')).toBeVisible();
    // The time really spent there, beside the stay asked for (0.53.0); the chip shows again
    // once the panel closes.
    await expect(
      page.locator('.trip-line .station.entry .chip', { hasText: 'Stay 60 min · 1h45 here' }),
    ).toHaveCount(1);
    // A disruption elsewhere on the VAE's route is said with its stops, not under the ride.
    const vae = page.locator('.trip-line li.ride', {
      has: page.locator('.product', { hasText: 'Voralpen-Express' }),
    });
    await expect(vae.locator('.warn', { hasText: 'elsewhere' })).toHaveCount(0);
    await vae.locator('.mids-toggle').click();
    await expect(vae.locator('.warn', { hasText: 'elsewhere' })).toHaveCount(1);
    const out = await page.evaluate(() => {
      const p = document.querySelector('.trip-line .panel')!.getBoundingClientRect();
      return [...document.querySelectorAll('.trip-line .panel button, .trip-line .panel input')]
        .filter((el) => el.getBoundingClientRect().right > p.right + 0.5)
        .map((el) => el.getAttribute('aria-label') ?? el.textContent);
    });
    expect(out).toEqual([]);
  });
});

// One object (0.52.0): the routes kept as "your trips" before come back once as past trips.
test('your trips kept before come back as past trips', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  allowUnrecorded(page);
  await page.goto('./');
  await page.evaluate(
    () =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open('keyval-store');
        open.onupgradeneeded = () => open.result.createObjectStore('keyval');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('keyval', 'readwrite');
          tx.objectStore('keyval').put(
            [
              {
                id: 'past-old',
                name: 'Old one',
                date: '2026-10-20',
                anchor: { departAt: '08:00' },
                ticket: 'GA',
                travelClass: 2,
                schema: 1,
                waypoints: [
                  { stopRef: 'ch:1:sloid:9000', name: 'Chur', kind: 'start', dwellMin: 0 },
                  { stopRef: 'ch:1:sloid:9157', name: 'Arosa', kind: 'end', dwellMin: 0 },
                ],
              },
            ],
            'srr.tours.v1',
          );
          tx.oncomplete = () => done();
        };
      }),
  );
  await page.reload();
  await page.getByText('Past trips (1)').click();
  await expect(page.getByRole('list', { name: 'Past trips' })).toContainText('Old one');
  // Once: after another reload it is there once, and the old list is empty.
  await page.reload();
  await expect(page.getByText('Past trips (1)')).toBeVisible();
});
