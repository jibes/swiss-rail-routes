import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';

test('loads, works offline after first visit', async ({ page, context }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // TODO: plan T3 from canned Worker answers once the planner exists (SPEC §8)
});

test('switches language and keeps it', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('combobox').selectOption('de');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bahn-Tagesausflug Schweiz');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`has no serious accessibility violations (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('./');
    const { violations } = await new AxeBuilder({ page }).analyze();
    const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(blocking.map((v) => v.id)).toEqual([]);
  });
}
