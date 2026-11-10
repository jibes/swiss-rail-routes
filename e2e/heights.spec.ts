import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { encodeTour } from '../tests/helpers/share';
import { BEFORE, expect, planShared, test } from './fixtures';

// A mountain station's height after its name (0.40.0), from 1000 m up; none in the valley.
test('Kleine Scheidegg says its height; Interlaken Ost none', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'High' }));
  const line = page.getByRole('list', { name: 'The trip', exact: true });
  await expect(
    line.locator('.station', { hasText: 'Kleine Scheidegg' }).locator('.alt'),
  ).toHaveText(' 2061 m', { timeout: 15_000 });
  await expect(line.locator('.station', { hasText: 'Interlaken Ost' }).locator('.alt')).toHaveCount(
    0,
  );
});
