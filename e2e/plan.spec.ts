import AxeBuilder from '@axe-core/playwright';
import { encodeTour } from '../src/core/export/share';
import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { BEFORE, expect, test } from './fixtures';

const axe = async (page: import('@playwright/test').Page) =>
  (await new AxeBuilder({ page }).analyze()).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);

test('a new trip plans itself: T5 with the GA warning, options, and stays on the list', async ({
  page,
}) => {
  await page.clock.install({ time: BEFORE });
  await page.goto('./');
  await page.getByRole('button', { name: 'New trip' }).click();
  // A new trip opens with the search: where it starts.
  const search = page.getByPlaceholder('Station, scenic line or past trip');
  await expect(search).toBeFocused();
  await search.fill('Interlaken Ost');
  await page.getByRole('button', { name: 'Interlaken Ost', exact: true }).click();
  await page.getByRole('button', { name: 'Add a station' }).click();
  await search.fill('Kleine Scheidegg');
  await search.press('Enter');

  // Next Saturday, 08:00 by default; Later asks for 09:00, the recorded plan.
  await expect(page.getByRole('button', { name: /Sat, Nov 7, 2026/ })).toBeVisible();
  await expect(page.locator('.hero-times:not(.busy)').or(page.getByRole('alert'))).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Later' }).click();
  await expect(page.locator('.hero-times:not(.busy)')).toContainText('09:04', { timeout: 30_000 });
  await expect(page.locator('.opt[aria-pressed="true"]')).toHaveCount(1);
  await expect(
    page
      .getByText(/Kleine Scheidegg: not covered by GA or day pass \(50.% off with them\)/)
      .first(),
  ).toBeVisible();
  await expect(page.getByText('R62', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('CC 63', { exact: true }).first()).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await axe(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: 'light' });

  // On the list with its day and times, and readable offline.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  const card = page.getByRole('link', { name: /Interlaken Ost → Kleine Scheidegg/ });
  await expect(card).toContainText('09:04');
  await page.context().setOffline(true);
  await page.reload();
  await expect(card).toBeVisible();
});

test('a trip left before its plan came is planned in the background', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  await page.goto(`./${encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'Left early' })}`);
  await page.getByRole('button', { name: 'Plan this trip' }).click();
  // Straight back, before the screen's own planner starts (it waits 400 ms for edits).
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  const card = page.getByRole('link', { name: /Left early/ });
  await expect(card).toContainText('09:04', { timeout: 30_000 });
});
