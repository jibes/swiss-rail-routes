import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { encodeTour } from '../tests/helpers/share';
import { allowUnrecorded, BEFORE, expect, planShared, test } from './fixtures';

// A station the plan chose (where you change) made yours with one action, Keep (0.59.0): one of
// your stations then, its own panel open, removed as any other.
test('keep the plan’s change as one of your stations; remove it again', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'Keep' }));
  // Each edit plans again: the new answers are not recorded, and need not be.
  allowUnrecorded(page);
  const line = page.getByRole('list', { name: 'The trip' });
  const yours = () => line.locator('li.station.entry');
  await expect(yours()).toHaveCount(2);
  // The plan's own station: muted; a tap says why, and offers to keep it.
  const change = line.locator('li.station.auto').first();
  // The name alone (its platform stands beside it, 0.50.0).
  const name = await change
    .locator('.n')
    .first()
    .evaluate((n) => n.firstChild!.textContent!.trim());
  await change.locator('button.m.locked').click();
  await expect(change.getByText(/The plan goes this way\. Keep it/)).toBeVisible();
  await change.getByRole('button', { name: 'Keep this station' }).click();
  await expect(yours()).toHaveCount(3);
  await expect(yours().nth(1)).toContainText(name);
  // One of yours: no pin, its panel as any station's, opened, with up, down and remove.
  await expect(line.locator('.pin-mark')).toHaveCount(0);
  const panel = page.locator('.panel');
  await expect(panel.getByRole('button', { name: `Move ${name} up` })).toBeVisible();
  await panel.getByRole('button', { name: `Remove ${name}` }).click();
  await expect(yours()).toHaveCount(2);
});

test('a stop the train calls at: kept with a tap, then a stay set in its panel', async ({
  page,
}) => {
  await page.clock.install({ time: BEFORE });
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'Stay' }));
  allowUnrecorded(page);
  const line = page.getByRole('list', { name: 'The trip' });
  await line.locator('.mids-toggle').first().click();
  const mid = line.locator('.mids .mid-name').first();
  const name = (await mid.textContent())!;
  await mid.click();
  await line.getByRole('button', { name: 'Keep this station' }).click();
  const added = line.locator('li.station.entry').filter({ hasText: name });
  await expect(added).toHaveCount(1);
  await page.locator('.panel').getByRole('button', { name: 'Stay', exact: true }).click();
  await expect(added).toContainText('30 min');
});
