// T1–T6 through the real UI: share link → save → plan → every alternative → export → map.
import { encodeTour } from '../src/core/export/share';
import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { expect, test } from './fixtures';

const tours = acceptanceTours(FIXTURE_DATE);

for (const [id, tour] of Object.entries(tours).filter(([k]) => k !== 'T5L')) {
  test(`${id} plans in the app`, async ({ page }) => {
    await page.goto(`./${encodeTour({ ...tour, name: id })}`);
    await page.getByRole('button', { name: 'Save to my tours' }).click();
    await page.getByRole('button', { name: 'Plan' }).click();

    // 2–3 options with different times as tabs, or one with a note.
    const tabs = page.getByRole('tab');
    await expect(tabs.first().or(page.getByText(/Only one connection/))).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('alert')).toHaveCount(0);
    const n = await tabs.count();
    const labels = await tabs.allInnerTexts();
    expect(new Set(labels.map((l) => l.split('\n')[0])).size, 'distinct times').toBe(n);
    if (n) await expect(page.getByRole('tab', { selected: true })).toContainText('Recommended');
    for (let i = 0; i < Math.max(n, 1); i++) {
      if (n) {
        await tabs.nth(i).click();
        await expect(tabs.nth(i)).toHaveAttribute('aria-selected', 'true');
      }
      expect(await page.locator('.chain > .leg').count()).toBeGreaterThan(0);
    }

    // Saved as a trip: one sbb.ch link per planned leg, the map, back to the timetable.
    await page.getByRole('button', { name: 'Save trip' }).click();
    const legs = await page.locator('.chain > .leg').count();
    expect(legs).toBeGreaterThan(0);
    await expect(page.getByRole('link', { name: /on sbb.ch/ })).toHaveCount(legs);

    await page.getByRole('button', { name: 'Map' }).click();
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Timetable' }).click();
    await expect(page).toHaveURL(/#\/trip\//);
    await expect(page.locator('.chain > .leg').first()).toBeVisible();
  });
}

test('Later moves the departure an hour and replans', async ({ page }) => {
  await page.goto(`./${encodeTour({ ...tours.T5!, name: 'T5' })}`);
  await page.getByRole('button', { name: 'Save to my tours' }).click();
  await page.getByRole('button', { name: 'Plan' }).click();
  const first = page.getByRole('tab').first();
  await expect(first).toBeVisible();
  const before = (await first.innerText()).slice(0, 5);
  await page.getByRole('button', { name: /Later/ }).click();
  await expect(first).not.toContainText(before);
  await expect(page.getByLabel('Time', { exact: true })).toHaveValue('10:00');
});
