import AxeBuilder from '@axe-core/playwright';
import { allowUnrecorded, BEFORE, expect, newTrip, pick, test } from './fixtures';

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
  // Grey is the timetable's: a tap says why it is not editable, and opens no panel.
  await line.locator('.station.ring button').first().click();
  await expect(page.getByText(/Part of the Brünig line/)).toBeVisible();
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
  await page.getByRole('button', { name: 'Remove Interlaken Ost' }).click();
  await expect(entries).toHaveCount(3);

  // Another station in the field keeps the stay.
  await entries.nth(1).getByRole('button').first().click();
  const field = page.getByRole('combobox', { name: 'Station' });
  await field.fill('Zug');
  await field.press('Enter');
  await expect(entries.nth(1)).toContainText('Zug');
  await expect(entries.nth(1)).toContainText('Stay 60 min');

  await page.reload();
  await expect(entries).toHaveText([/^Zürich HB/, /^Zug/, /^Zürich HB/]);
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
  // A bus stop is said to be one.
  await search.fill('Bernina Suot, Bahnhof');
  await expect(
    page.locator('.add-sheet .result', { hasText: 'Bernina Suot, Bahnhof' }),
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
