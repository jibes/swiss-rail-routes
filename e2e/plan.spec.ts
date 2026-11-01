import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';

test('plans T5 and shows the GA warning, alternatives and exports', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'New tour' }).click();
  const search = page.locator('.picker input');
  await search.fill('Interlaken Ost');
  await search.press('Enter');
  await search.fill('Kleine Scheidegg');
  await search.press('Enter');
  await page.getByRole('button', { name: 'Plan' }).click();
  // A click anywhere on the date or time pill opens the browser's picker (not just its icon).
  await page.evaluate(() => {
    (window as unknown as { picked: string[] }).picked = [];
    HTMLInputElement.prototype.showPicker = function () {
      (window as unknown as { picked: string[] }).picked.push(this.type);
    };
  });
  await page.getByLabel('Date').click({ position: { x: 12, y: 12 } });
  await page.getByLabel('Time', { exact: true }).click({ position: { x: 8, y: 12 } });
  expect(await page.evaluate(() => (window as unknown as { picked: string[] }).picked)).toEqual([
    'date',
    'time',
  ]);
  // When is set on the planning screen.
  await page.getByLabel('Date').fill('2026-11-07');
  await page.getByLabel('Time', { exact: true }).fill('09:00');

  await expect(page.getByRole('tab', { selected: true })).toContainText('Recommended');
  await expect(
    page.getByText(/Not covered by GA or day pass .*Kleine Scheidegg: 50 % with them/).first(),
  ).toBeVisible();
  await expect(page.getByText('R62', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('CC 63', { exact: true }).first()).toBeVisible();
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

  // Save the recommended option as a trip: its timetable, tickets and exports.
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('button', { name: 'Save trip' }).click();
  await expect(page).toHaveURL(/#\/trip\//);
  await expect(page.getByText('R62', { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Open Interlaken Ost → Kleine Scheidegg on sbb.ch/ }),
  ).toBeVisible();

  // Listed under Trips, and readable offline.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('link', { name: /Interlaken Ost → Kleine Scheidegg/ })).toBeVisible();
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole('link', { name: /Interlaken Ost → Kleine Scheidegg/ })).toBeVisible();
});
