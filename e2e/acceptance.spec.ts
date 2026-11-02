// T1–T6 through the real UI: route link → trip → every option → calendar → map.
import { encodeTour } from '../src/core/export/share';
import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { BEFORE, expect, planShared, test } from './fixtures';

const tours = acceptanceTours(FIXTURE_DATE);

for (const [id, tour] of Object.entries(tours).filter(([k]) => k !== 'T5L')) {
  test(`${id} plans in the app`, async ({ page }) => {
    await page.clock.install({ time: BEFORE });
    await planShared(page, encodeTour({ ...tour, name: id }));
    await expect(page.getByRole('alert')).toHaveCount(0);
    // T1's Vereina stations are not reached at this time: on the line, struck, with Try later.
    if (id === 'T1') {
      await expect(page.locator('.trip-line .station.missed').first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Try an hour later' }).first()).toBeVisible();
    }

    // 2–3 options with different times, the recommended one chosen; or one with a note.
    const opts = page.getByRole('group', { name: 'Alternatives' }).getByRole('button');
    const n = await opts.count();
    if (n) {
      const labels = await opts.allInnerTexts();
      expect(new Set(labels.map((l) => l.split('\n')[0])).size, 'distinct times').toBe(n);
      await expect(page.locator('.opt[aria-pressed="true"] .best')).toHaveCount(1);
    } else await expect(page.getByText(/Only one connection/)).toBeVisible();
    for (let i = 0; i < Math.max(n, 1); i++) {
      if (n) {
        await opts.nth(i).click();
        await expect(opts.nth(i)).toHaveAttribute('aria-pressed', 'true');
      }
      expect(await page.locator('.trip-line .ride').count()).toBeGreaterThan(0);
    }

    // The calendar is in the menu; the map shows the trip and goes back to it.
    await page.getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('menuitem', { name: /Calendar/ })).toBeVisible();
    await page.locator('.menu-scrim').click({ position: { x: 5, y: 400 } });
    await page.getByRole('button', { name: 'Map' }).click();
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Timetable' }).click();
    await expect(page).toHaveURL(/#\/trip\//);
    await expect(page.locator('.trip-line .ride').first()).toBeVisible();
  });
}

test('Later starts after the last option, in whole hours; the options stay while it plans', async ({
  page,
}) => {
  await page.clock.install({ time: BEFORE });
  await planShared(page, encodeTour({ ...tours.T5!, name: 'T5' }));
  const opts = page.getByRole('group', { name: 'Alternatives' }).getByRole('button');
  const times = (await opts.allInnerTexts()).map((x) => x.split('\n')[0]!.trim());
  const [h, m] = times.at(-1)!.split(':').map(Number) as [number, number];
  // From 09:00, the first whole hour after the last option found.
  const next = `${String(Math.floor((h * 60 + m - 9 * 60) / 60) + 10).padStart(2, '0')}:00`;
  await page.getByRole('button', { name: 'Later' }).click();
  // Nothing is recorded for that time: the plan fails, and the bar says from when it looked.
  await expect(page.locator('.options-bar .single')).toHaveText(`from ${next}`, {
    timeout: 30_000,
  });
});
