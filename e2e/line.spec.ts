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
  await expect(line.locator('.station.ring')).toHaveCount(0);
  // A via between your first and last station is pinned: its panel unpins it.
  await page.getByRole('button', { name: 'Unpin Interlaken Ost' }).click();
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

test('a trip whose day is over leaves the list and waits in search', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  await newTrip(page, 'Chur', 'Arosa');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('link', { name: /Chur → Arosa/ })).toBeVisible();

  // The Sunday after: gone from the list, offered first in search.
  await page.clock.setSystemTime(new Date('2026-11-08T08:00:00Z'));
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nothing planned');
  await page.getByRole('button', { name: 'New trip' }).click();
  await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible();
  await page.getByRole('button', { name: /^Chur → Arosa/ }).click();
  await expect(page.locator('.trip-line .station.entry')).toHaveText([/^Chur/, /^Arosa/]);
  // A new trip, today.
  await expect(page.getByLabel('Date')).toHaveValue('2026-11-08');

  // Forgotten, it is gone from search.
  await page.getByRole('button', { name: 'Add a station' }).click();
  await page.getByRole('button', { name: /^Forget/ }).click();
  await expect(page.getByRole('heading', { name: 'Your trips' })).toHaveCount(0);
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

test('a stay with a time to leave by: set, kept after reload, taken off', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  allowUnrecorded(page);
  await newTrip(page, 'zürich hb', 'luzern', 'bern');
  const entries = page.getByRole('list', { name: 'The trip' }).locator('.station.entry');
  await entries.nth(1).getByRole('button').first().click();
  // Only a stay has a time to leave by.
  await expect(page.getByLabel('Leave Luzern by')).toHaveCount(0);
  await page
    .getByRole('group', { name: 'At this station' })
    .getByRole('button', { name: 'Stay', exact: true })
    .click();
  await expect(page.locator('.panel .leave-by')).toContainText('Leave by Any time');
  const field = page.getByLabel('Leave Luzern by');
  await field.fill('17:30');
  await field.press('Enter');
  await expect(page.locator('.panel .leave-by')).toContainText('Leave by 17:30');
  // The line says it without the panel.
  await expect(entries.nth(1)).toContainText('Stay 30 min, by 17:30');

  await page.reload();
  await entries.nth(1).getByRole('button').first().click();
  await expect(page.locator('.panel .leave-by')).toContainText('Leave by 17:30');
  await page.getByRole('button', { name: 'Leave Luzern at any time' }).click();
  await expect(page.locator('.panel .leave-by')).toContainText('Leave by Any time');
  // Riding through again, the time goes with the stay.
  await page
    .getByRole('group', { name: 'At this station' })
    .getByRole('button', { name: 'No stop' })
    .click();
  await expect(page.locator('.panel .leave-by')).toHaveCount(0);
});

// Reported on the MCP (5 Nov 2026): "Swissminiatur" found only its pier. A place people go to
// is found by its name and adds the stop nearest it, the walk said.
test('a place found by its name adds its stop', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'New trip' }).click();
  await page.getByPlaceholder('Station, scenic line or past trip').fill('Swissminiatur');
  const place = page.getByRole('button', {
    name: /^Swissminiatur Melide · about \d+ min on foot$/,
  });
  await expect(page.getByRole('heading', { name: 'Places' })).toBeVisible();
  await place.click();
  await expect(page.locator('.trip-line .station', { hasText: 'Melide' })).toBeVisible();
});

// ⋯ → Reverse direction: a round trip runs its loop the other way from the same start, the
// scenic line with it; a stay keeps its station, its time to leave by goes and is said. These
// routes are about editing: the reversed one is planned, but nothing is recorded for it.
test('reverse direction: the loop the other way, the line with it, a window said gone', async ({
  page,
}) => {
  await page.clock.install({ time: BEFORE });
  allowUnrecorded(page);
  await newTrip(page, 'zürich hb', 'luzern');
  await page.getByRole('button', { name: 'Add a station' }).click();
  await pick(page, 'brünig', /^Brünig.*Luzern → Interlaken Ost/);
  await page.getByRole('button', { name: 'Add a station' }).click();
  await page.getByRole('button', { name: /^Back to Zürich HB/ }).click();
  const line = page.getByRole('list', { name: 'The trip' });
  const entries = line.locator('.station.entry');
  await expect(entries).toHaveText([/^Zürich HB/, /^Luzern/, /^Interlaken Ost/, /^Zürich HB/]);
  // A stay at Luzern, to leave by 17:30.
  await entries.nth(1).getByRole('button').first().click();
  await page
    .getByRole('group', { name: 'At this station' })
    .getByRole('button', { name: 'Stay', exact: true })
    .click();
  const field = page.getByLabel('Leave Luzern by');
  await field.fill('17:30');
  await field.press('Enter');
  await page.keyboard.press('Escape');
  await expect(entries.nth(1)).toContainText('by 17:30');
  const ringsOut = (await line.locator('.station.ring').allInnerTexts()).map((x) => x.trim());
  expect(ringsOut.length).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Reverse direction' }).click();
  await expect(entries).toHaveText([/^Zürich HB/, /^Interlaken Ost/, /^Luzern/, /^Zürich HB/]);
  // The Brünig line now runs Interlaken Ost → Luzern: its stations between, in that order.
  const ringsBack = (await line.locator('.station.ring').allInnerTexts()).map((x) => x.trim());
  expect(ringsBack).toEqual([...ringsOut].reverse());
  await expect(entries.nth(2)).toContainText('Stay 30 min');
  await expect(entries.nth(2)).not.toContainText('by 17:30');
  await expect(
    page.getByRole('status').filter({ hasText: 'Stay time windows removed' }),
  ).toBeVisible();

  // Twice is the trip it was (without the window).
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Reverse direction' }).click();
  await expect(entries).toHaveText([/^Zürich HB/, /^Luzern/, /^Interlaken Ost/, /^Zürich HB/]);
  await expect(entries.nth(1)).toContainText('Stay 30 min');
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
  // Start and end: no train to wait between.
  await expect(line.locator(':scope > li.station').first().locator('.offtrain')).toHaveCount(0);
  await expect(line.locator(':scope > li.station').last().locator('.offtrain')).toHaveCount(0);
});

// Over several days (0.44.0): a stay until a date and time, said on the line; kept after reload.
test('a stay until a date and time: set, said on the line, taken off', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  allowUnrecorded(page);
  await newTrip(page, 'zürich hb', 'luzern', 'bern');
  const entries = page.getByRole('list', { name: 'The trip' }).locator('.station.entry');
  await entries.nth(1).getByRole('button').first().click();
  await page
    .getByRole('group', { name: 'At this station' })
    .getByRole('button', { name: 'Stay', exact: true })
    .click();
  const day = page.getByLabel('Stay at Luzern until (day)');
  await day.fill('2026-11-09');
  await day.press('Enter');
  await expect(page.locator('.panel .stay-until')).toContainText(/Stay until .*9.*08:00/);
  const time = page.getByLabel('Stay at Luzern until (time)');
  await time.fill('09:15');
  await time.press('Enter');
  await expect(entries.nth(1)).toContainText(/Stay until .*9.*09:15/);
  await page.reload();
  await expect(entries.nth(1)).toContainText(/Stay until .*9.*09:15/);
  await entries.nth(1).getByRole('button').first().click();
  await page.getByRole('button', { name: 'Stay at Luzern for its length only' }).click();
  await expect(entries.nth(1)).toContainText('Stay 30 min');
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
