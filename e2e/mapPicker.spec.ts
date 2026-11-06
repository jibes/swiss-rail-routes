import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { encodeTour } from '../tests/helpers/share';
import { allowUnrecorded, BEFORE, expect, planShared, test } from './fixtures';

// The map planner (MapPicker.tsx): from the trip's last station, the places its trains reach
// without a change; a tap on one adds it, and the web goes on from there if asked.
test('pick on the map: the trains from the last station, a tap adds a place', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'Map pick' }));
  // Adding changes the trip: its new plan has no recorded answer, and needs none here.
  allowUnrecorded(page);
  await page.getByRole('button', { name: 'Add a station' }).click();
  await page.getByRole('button', { name: /Pick on the map/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Pick on the map' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/^From Kleine Scheidegg at \d\d:\d\d/)).toBeVisible();
  await expect(dialog.getByText(/Lines are the trains from here/)).toBeVisible({ timeout: 15_000 });
  // The places reached, as a list too: Wengen is one, by the train down to Lauterbrunnen.
  await dialog.getByText(/^Places reached \(\d+\)$/).click();
  await dialog.getByRole('button', { name: /^Wengen \d\d:\d\d$/ }).click();
  await expect(dialog.getByRole('heading', { name: 'Wengen' })).toBeVisible();
  await expect(dialog.getByText(/^Direct: at \d\d:\d\d with the /)).toBeVisible();
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  // Added after the last station, the map closes, and the trip plans with it.
  await expect(dialog).toBeHidden();
  await expect(page.locator('li.station').filter({ hasText: 'Wengen' }).first()).toBeVisible();
});
