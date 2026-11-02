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
    // T1 on the recorded day: replacement buses on the Albula line stop outside the stations
    // ("Bergün/Bravuogn, posta"); the stations still count as reached, none struck.
    if (id === 'T1') {
      await expect(
        page.locator('.trip-line .station', { hasText: 'Bergün' }).first(),
      ).toBeVisible();
      await expect(page.locator('.trip-line .station.missed')).toHaveCount(0);
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

test('the arrows load more options without changing the trip; a tap chooses one', async ({
  page,
}) => {
  await page.clock.install({ time: BEFORE });
  await planShared(page, encodeTour({ ...tours.T5!, name: 'T5' }));
  const opts = page.getByRole('group', { name: 'Alternatives' }).getByRole('button');
  const n = await opts.count();
  const hero = (await page.locator('.hero-times').textContent()) ?? '';
  // Nothing recorded after the last option: the bar says it could not load more, and the trip
  // and its options stay as they were.
  await page.getByRole('button', { name: 'Later connections' }).click();
  await expect(page.getByText('Could not load more connections. Try again.')).toBeVisible({
    timeout: 30_000,
  });
  await expect(opts).toHaveCount(n);
  await expect(page.locator('.hero-times')).toHaveText(hero);
  // Another option becomes the trip at once (no new request), the others stay to choose from.
  if (n > 1) {
    const other = opts.filter({ hasNot: page.locator('.best') }).first();
    const time = (await other.innerText()).split('\n')[0]!.trim();
    await other.click();
    await expect(page.locator('.hero-times')).toContainText(time);
    await expect(opts).toHaveCount(n);
  }
});
