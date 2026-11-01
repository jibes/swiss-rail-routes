import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';

test('builds a round trip from stations and a template, keeps it after reload', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'New tour' }).click();

  const search = page.locator('.picker input');
  await expect(search).toBeEnabled();
  await search.fill('zürich hb');
  await page.getByRole('option', { name: 'Zürich HB', exact: true }).click();
  await search.fill('luzern');
  await search.press('Enter');

  await page.getByRole('button', { name: 'Add a route' }).click();
  await page.getByRole('button', { name: /^Brünig/ }).click();
  await page.getByRole('checkbox', { name: 'Round trip' }).check();

  const rows = page.getByRole('list', { name: 'Stops' }).getByRole('listitem');
  await expect(rows.first()).toContainText('Zürich HB');
  await expect(rows.last()).toContainText('Zürich HB');
  await expect(rows.filter({ hasText: 'Meiringen' })).toHaveCount(1);

  const luzern = rows.filter({ hasText: /^Luzern/ }).first();
  await luzern.getByRole('checkbox', { name: 'Get off' }).check();
  await luzern.getByRole('button', { name: '60 min' }).click();
  await page.getByLabel('Tour name').fill('Brünig loop');

  const results = new AxeBuilder({ page }).analyze();
  const blocking = (await results).violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(blocking.map((v) => v.id)).toEqual([]);

  await page.waitForTimeout(400); // debounced save
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Brünig loop');
  await page.getByRole('button', { name: /Back/ }).click();
  await expect(page.getByRole('link', { name: /Brünig loop/ })).toBeVisible();
});
