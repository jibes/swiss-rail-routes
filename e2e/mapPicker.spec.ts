import { readFile } from 'node:fs/promises';
import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { encodeTour } from '../tests/helpers/share';
import { allowUnrecorded, BEFORE, expect, planShared, test } from './fixtures';

// Adding on the map (MapAdd.tsx): the trip's own map, and on it the places the trains from the
// trip's last station reach without a change; a tap on one adds it, and the web goes on from it.
test('pick on the map: the trip’s map, the trains from its last station, a tap adds a place', async ({
  page,
}) => {
  await page.clock.install({ time: BEFORE });
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'Map pick' }));
  // Adding changes the trip: its new plan has no recorded answer, and needs none here.
  allowUnrecorded(page);
  await page.getByRole('button', { name: 'Add a station' }).click();
  // From its last station, said whole (reported in review: "From Kleine Scheidegg at").
  await expect(page.getByRole('button', { name: /Pick on the map/ })).toContainText(
    /From Kleine Scheidegg$/,
  );
  await page.getByRole('button', { name: /Pick on the map/ }).click();
  // The trip's own map, not another: its screen, adding from Kleine Scheidegg.
  await expect(page).toHaveURL(/#\/trip\/[^/]+\/map$/);
  const map = page.locator('.mapview');
  await expect(map.getByText(/^From Kleine Scheidegg at \d\d:\d\d/)).toBeVisible();
  await expect(map.getByText(/Blue: the trains from Kleine Scheidegg/)).toBeVisible({
    timeout: 15_000,
  });
  // The places reached, as a list too: Wengen is one, by the train down to Lauterbrunnen.
  await map.getByText(/^Places reached \(\d+\)$/).click();
  await map.getByRole('button', { name: /^Wengen \d\d:\d\d$/ }).click();
  await expect(map.getByRole('heading', { name: 'Wengen' })).toBeVisible();
  await expect(map.getByText(/^Direct: at \d\d:\d\d with the /)).toBeVisible();
  await map.getByRole('button', { name: 'Add', exact: true }).click();
  // Added, and the web goes on from it; Done ends adding, the trip has it.
  await expect(map.getByText(/^From Wengen at \d\d:\d\d · 1 added/)).toBeVisible();
  await map.getByRole('button', { name: 'Done' }).click();
  await expect(map.getByText(/^From Wengen/)).toHaveCount(0);
  await map.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('li.station').filter({ hasText: 'Wengen' }).first()).toBeVisible();
});

test('a tap anywhere: the stops near it, stations further, bus stops close, by their means', async ({
  page,
}, info) => {
  // Where to tap is a point on the screen: the phone's, which this was measured on.
  test.skip(info.project.name !== 'phone', 'the tap is placed on the phone screen');
  await page.clock.install({ time: BEFORE });
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'Map tap' }));
  allowUnrecorded(page);
  // From the map itself: Add stops starts from the trip's last station.
  await page.goto(page.url() + '/map');
  const map = page.locator('.mapview');
  await map.getByRole('button', { name: 'Add stops on the map' }).click();
  await expect(map.getByText(/Blue: the trains from Kleine Scheidegg/)).toBeVisible({
    timeout: 15_000,
  });
  // West of Kleine Scheidegg, beside Wengen's dot, not on it (the web fitted to the phone's screen).
  await page.waitForTimeout(800);
  const box = (await map.locator('.map').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.25 + 40, box.y + box.height * 0.45);
  await expect(map.getByRole('heading', { name: 'Near here' })).toBeVisible();
  // Each with its means (the round dot for a station, an icon for the others).
  const first = map.locator('.map-picker-near .result').first();
  await expect(first.locator('.r-icon')).toHaveCount(1);
  const name = (await first.locator('.r-name').textContent())!;
  await first.click();
  // Its train if one goes there direct, else about how long.
  await expect(map.getByRole('heading', { name })).toBeVisible();
  await expect(map.getByText(/^(Direct: at |About )/)).toBeVisible();
});

// Log of 6 Nov 2026: the same web was set on the map seven times while the map stood still.
test('the web is drawn once for the station it starts from', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  await page.goto('./#/settings');
  await page.getByRole('switch', { name: 'Keep a debug log' }).check();
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'Map once' }));
  await page.goto(page.url() + '/map');
  await page.getByRole('button', { name: 'Add stops on the map' }).click();
  await expect(page.getByText(/Blue: the trains from Kleine Scheidegg/)).toBeVisible({
    timeout: 15_000,
  });
  // The map moving, the pointer over it: nothing new to draw.
  await page.mouse.move(200, 400);
  await page.mouse.move(220, 420);
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.goto('./#/settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save file' }).click();
  const text = await readFile((await (await download).path())!, 'utf8');
  expect(text.split('\n').filter((l) => l.includes(' mapPick.web '))).toHaveLength(1);
});

// One trip view (0.46.0): under way the map adds too, into the rest of the trip being changed;
// the trip screen then offers Update and Discard, the trip itself untouched until Update.
test('under way, the map adds into the rest; the trip offers Update or Discard', async ({
  page,
}) => {
  await page.clock.install({ time: new Date(`${FIXTURE_DATE}T07:50:00Z`) }); // planned at 08:50
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'Map live' }));
  // 09:15, on the R62: the web from Kleine Scheidegg then has no recorded answer, nor the rest.
  await page.clock.runFor('25:00');
  allowUnrecorded(page);
  await page.goto(page.url() + '/map');
  await page.getByRole('button', { name: 'Add stops on the map' }).click();
  await expect(page.getByText(/Kleine Scheidegg/).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Discard' })).toBeVisible();
  await expect(page.locator('.trip-line.past')).toHaveCount(1);
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.locator('.trip-line.past')).toHaveCount(0);
});
