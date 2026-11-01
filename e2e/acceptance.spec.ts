// T1–T6 through the real UI: share link → save → plan → every alternative → export → map.
import { encodeTour } from '../src/core/export/share';
import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { expect, test } from './fixtures';

const tours = acceptanceTours(FIXTURE_DATE);

for (const [id, tour] of Object.entries(tours)) {
  test(`${id} plans in the app`, async ({ page }) => {
    await page.goto(`./${encodeTour({ ...tour, name: id })}`);
    await page.getByRole('button', { name: 'Save to my tours' }).click();
    await page.getByRole('button', { name: 'Plan' }).click();

    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(3, { timeout: 30_000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
    for (const name of ['Earliest', 'Recommended', 'Latest']) {
      const tab = page.getByRole('tab', { name: new RegExp(name) });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      const legs = page.locator('.chain > .leg');
      const n = await legs.count();
      expect(n).toBeGreaterThan(0);
      // One sbb.ch link per planned leg.
      await expect(page.getByRole('link', { name: /on sbb.ch/ })).toHaveCount(n);
    }

    await page.getByRole('button', { name: 'Map' }).click();
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Timetable' }).click();
    await expect(tabs).toHaveCount(3);
  });
}
