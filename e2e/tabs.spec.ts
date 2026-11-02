import { encodeTour } from '../src/core/export/share';
import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { answerWorker, BEFORE, expect, planShared, test } from './fixtures';

// Two tabs (an installed app window and a browser tab) share one saved list: a trip added in
// one is never lost to a save from the other, and the other tab shows it.
test('two tabs: each one’s new trip stays, and each sees the other’s', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  await page.goto('./');
  const other = await page.context().newPage();
  await answerWorker(other);
  await other.clock.install({ time: BEFORE });
  await other.goto('./');
  await expect(other.getByRole('heading', { level: 1 })).toBeVisible();

  const tours = acceptanceTours(FIXTURE_DATE);
  await planShared(page, encodeTour({ ...tours.T5!, name: 'From tab one' }));
  // The other tab, opened before, adds its own trip: saving must not drop the first one.
  await planShared(other, encodeTour({ ...tours.T3!, name: 'From tab two' }));

  await other.goto('./#/');
  await expect(other.getByRole('link', { name: /From tab one/ })).toBeVisible();
  await page.goto('./#/');
  await expect(page.getByRole('link', { name: /From tab two/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: /From tab one/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /From tab two/ })).toBeVisible();
  await other.close();
});
