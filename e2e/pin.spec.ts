import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { encodeTour } from '../tests/helpers/share';
import { allowUnrecorded, BEFORE, expect, planShared, test } from './fixtures';

// A station the plan chose (where you change) made yours: pinned as a via, the way kept; its
// panel unpins it, and Undo pins it back.
test('pin the plan’s change as a via; unpin it; undo', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'Pin' }));
  // Each edit plans again: the new answers are not recorded, and need not be.
  allowUnrecorded(page);
  const line = page.getByRole('list', { name: 'The trip' });
  const yours = () => line.locator('li.station.entry');
  await expect(yours()).toHaveCount(2);
  // The plan's own station: muted; a tap says why, and offers to pin it.
  const change = line.locator('li.station.auto').first();
  // The name alone (its platform stands beside it, 0.50.0).
  const name = await change
    .locator('.n')
    .first()
    .evaluate((n) => n.firstChild!.textContent!.trim());
  await change.locator('button.m.locked').click();
  await expect(change.getByText(/The plan goes this way\. Pin it/)).toBeVisible();
  await change.getByRole('button', { name: 'Pin' }).click();
  await expect(yours()).toHaveCount(3);
  await expect(yours().nth(1)).toContainText(name);
  // Pinned: the pin by its name is the state; its panel has no name field and no moves (the
  // plan must pass it where the train does), and Unpin, in words, is the action.
  await expect(yours().nth(1).locator('.pin-mark')).toBeVisible();
  // The plan's note goes with the tap that made it yours.
  await expect(line.getByText(/Added by the timetable/)).toHaveCount(0);
  const panel = page.locator('.panel');
  await expect(panel.getByRole('combobox', { name: 'Station' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: `Move ${name} up` })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: `Unpin ${name}` })).toHaveText('Unpin');
  await page.getByRole('button', { name: `Unpin ${name}` }).click();
  await expect(yours()).toHaveCount(2);
  await expect(page.getByRole('status').filter({ hasText: `${name} unpinned.` })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(yours()).toHaveCount(3);
  await expect(yours().nth(1)).toContainText(name);
});

test('a stop the train calls at: stay there with a tap', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'Stay' }));
  allowUnrecorded(page);
  const line = page.getByRole('list', { name: 'The trip' });
  await line.locator('.mids-toggle').first().click();
  const mid = line.locator('.mids .mid-name').first();
  const name = (await mid.textContent())!;
  await mid.click();
  await line.getByRole('button', { name: 'Stay here' }).click();
  const added = line.locator('li.station.entry').filter({ hasText: name });
  await expect(added).toHaveCount(1);
  await expect(added).toContainText('30 min');
});
