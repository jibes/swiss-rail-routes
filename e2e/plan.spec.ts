import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';

test('plans T5 and shows the GA warning, alternatives and exports', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'New tour' }).click();
  await page.getByLabel('Date').fill('2026-11-07');
  await page.getByLabel('Time', { exact: true }).fill('09:00');
  const search = page.locator('.picker input');
  await search.fill('Interlaken Ost');
  await search.press('Enter');
  await search.fill('Kleine Scheidegg');
  await search.press('Enter');
  await page.getByRole('button', { name: 'Plan' }).click();

  await expect(page.getByRole('tab', { selected: true })).toContainText('Recommended');
  await expect(
    page.getByText(/Not covered by GA .*Kleine Scheidegg: 50 % with GA/).first(),
  ).toBeVisible();
  await expect(page.getByText('R62', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('CC 63', { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Open Interlaken Ost → Kleine Scheidegg on sbb.ch/ }),
  ).toBeVisible();

  const blocking = (await new AxeBuilder({ page }).analyze()).violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);

  await page.emulateMedia({ colorScheme: 'dark' });
  const dark = (await new AxeBuilder({ page }).analyze()).violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(dark.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual(
    [],
  );

  // The plan is kept: offline, the timeline still shows it.
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole('tab', { selected: true })).toContainText('Recommended');
});
