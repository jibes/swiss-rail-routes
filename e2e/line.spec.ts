import AxeBuilder from '@axe-core/playwright';
import { BEFORE, expect, test } from './fixtures';

const add = async (page: import('@playwright/test').Page, text: string, pick?: RegExp) => {
  const search = page.getByPlaceholder('Station, scenic line or past trip');
  await search.fill(text);
  if (pick) await page.getByRole('button', { name: pick }).first().click();
  else await search.press('Enter');
};

test('one line: stations, a scenic line as rings, the panel, a round trip, kept after reload', async ({
  page,
}) => {
  await page.clock.install({ time: BEFORE });
  await page.goto('./');
  await page.getByRole('button', { name: 'New trip' }).click();
  await add(page, 'zürich hb');
  await page.getByRole('button', { name: 'Add a station' }).click();
  await add(page, 'luzern');
  await page.getByRole('button', { name: 'Add a station' }).click();
  // A scenic line from where you are: its end station is yours, the stations between are rings.
  await add(page, 'brünig', /^Brünig.*Luzern → Interlaken Ost/);
  await page.getByRole('button', { name: 'Add a station' }).click();
  await page.getByRole('button', { name: /^Back to Zürich HB/ }).click();

  const line = page.getByRole('list', { name: 'The trip' });
  const entries = line.locator('.station.entry');
  await expect(entries).toHaveText([/^Zürich HB/, /^Luzern/, /^Interlaken Ost/, /^Zürich HB/]);
  await expect(line.locator('.station.ring').first()).toBeVisible();
  await expect(line.locator('.station.ring button')).toHaveCount(0);

  // The panel: what you do there, the line that leads there, add after, up, down, remove.
  await entries.nth(1).getByRole('button').first().click();
  await page
    .getByRole('group', { name: 'At this station' })
    .getByRole('button', { name: '60 min' })
    .click();
  await expect(entries.nth(1)).toContainText('Stay 60 min');
  await entries.nth(2).getByRole('button').first().click();
  await expect(page.getByText('Via Brünig')).toBeVisible();
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
  await page.goto('./');
  await page.getByRole('button', { name: 'New trip' }).click();
  for (const s of ['Bern', 'Thun', 'Spiez', 'Brig']) {
    if (s !== 'Bern') await page.getByRole('button', { name: 'Add a station' }).click();
    await add(page, s);
  }
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

test('a trip whose day is over leaves the list and waits in search', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  await page.goto('./');
  await page.getByRole('button', { name: 'New trip' }).click();
  await add(page, 'Chur');
  await page.getByRole('button', { name: 'Add a station' }).click();
  await add(page, 'Arosa');
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
  // A new date, next Saturday.
  await expect(page.getByRole('button', { name: /Sat, Nov 14, 2026/ })).toBeVisible();

  // Forgotten, it is gone from search.
  await page.getByRole('button', { name: 'Add a station' }).click();
  await page.getByRole('button', { name: /^Forget/ }).click();
  await expect(page.getByRole('heading', { name: 'Your trips' })).toHaveCount(0);
});
