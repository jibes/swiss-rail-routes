import AxeBuilder from '@axe-core/playwright';
import { encodeTour } from '../tests/helpers/share';
import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { BEFORE, expect, planShared, test } from './fixtures';

test('loads, and a planned trip is readable offline after the first visit (SPEC §8)', async ({
  page,
  context,
}) => {
  await page.clock.install({ time: BEFORE });
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'T5' }));
  const times = (await page.locator('.hero-times').textContent())!;
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  // The shell from the service worker, the trip and its timetable from the device.
  await expect(page.locator('.hero-times')).toHaveText(times);
  await expect(page.locator('.trip-line .ride').first()).toBeVisible();
  await page.goto('./');
  await expect(page.getByRole('link', { name: /T5/ })).toBeVisible();
});

test('switches language and keeps it', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('combobox', { name: 'Language' }).click();
  await page.getByRole('option', { name: 'Deutsch' }).click();
  await page.getByRole('button', { name: 'Zurück' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nichts geplant');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`has no serious accessibility violations (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('./');
    const { violations } = await new AxeBuilder({ page }).analyze();
    const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(
      blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
  });
}
