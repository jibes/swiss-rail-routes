import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { encodeTour } from '../tests/helpers/share';
import { BEFORE, expect, planShared, test } from './fixtures';

// How full a train is expected to be (0.39.0): said on the ride only when seats are few, for the
// trip's class. T2's recorded answers have one such train in second class.
test('a train with few seats free says so on its ride, nothing on the others', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T2!, name: 'Busy' }));
  const line = page.getByRole('list', { name: 'The trip' });
  await expect(line.locator('.ride').first()).toBeVisible({ timeout: 15_000 });
  await expect(line.locator('.occ')).toHaveText(['Few seats free']);
});
