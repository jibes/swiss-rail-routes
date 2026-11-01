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

  await page.getByRole('button', { name: /^Brünig/ }).click();
  await page.getByRole('checkbox', { name: 'Round trip' }).check();

  const rows = page.getByRole('list', { name: 'Stops' }).getByRole('listitem');
  await expect(rows.first()).toContainText('Zürich HB');
  await expect(rows.last()).toContainText('Zürich HB');
  await expect(rows.filter({ hasText: 'Meiringen' })).toHaveCount(1);

  // Tap a station's name to edit it in place: the stay beside it, a styled list.
  await rows
    .filter({ hasText: /^Luzern/ })
    .first()
    .getByRole('button', { name: /^Luzern/ })
    .click();
  const field = page.getByRole('combobox', { name: 'Instead of Luzern' });
  await expect(field).toBeFocused();
  await page.getByRole('combobox', { name: 'Stay at Luzern' }).click();
  await page.getByRole('option', { name: '1h', exact: true }).click();
  await expect(field).toBeVisible(); // still editing: the list is part of the field
  // Another station in the same field: the stay stays.
  await field.fill('Zug');
  await field.press('Enter');
  const zug = rows.filter({ hasText: /^Zug/ }).first();
  await expect(zug).toContainText('1h');
  await zug.getByRole('button', { name: /^Zug/ }).click();
  await page.getByRole('combobox', { name: 'Instead of Zug' }).fill('Luzern');
  await page.getByRole('combobox', { name: 'Instead of Zug' }).press('Enter');
  await expect(rows.filter({ hasText: /^Luzern/ }).first()).toContainText('1h');
  // Escape leaves it unchanged; cleared and left, the station goes.
  await rows
    .filter({ hasText: 'Sarnen' })
    .getByRole('button', { name: /^Sarnen/ })
    .click();
  await page.getByRole('combobox', { name: 'Instead of Sarnen' }).press('Escape');
  await expect(rows.filter({ hasText: 'Sarnen' })).toHaveCount(1);
  await rows
    .filter({ hasText: 'Sarnen' })
    .getByRole('button', { name: /^Sarnen/ })
    .click();
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.getByLabel('Tour name').click();
  await expect(rows.filter({ hasText: 'Sarnen' })).toHaveCount(0);
  await page.getByLabel('Tour name').fill('Brünig loop');

  const results = new AxeBuilder({ page }).analyze();
  const blocking = (await results).violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);

  await page.waitForTimeout(400); // debounced save
  await page.reload();
  await expect(page.getByLabel('Tour name')).toHaveValue('Brünig loop');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('link', { name: /Brünig loop/ })).toBeVisible();
});

test('reorders stations by dragging the grip, and with arrow keys', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'New tour' }).click();
  const search = page.locator('.picker input');
  for (const name of ['Zürich HB', 'Luzern', 'Bern', 'Thun']) {
    await search.fill(name);
    await page.getByRole('option', { name, exact: true }).click();
  }
  const names = () => page.locator('.line > li .stop-name > span:first-child').allInnerTexts();
  await expect.poll(names).toEqual(['Zürich HB', 'Luzern', 'Bern', 'Thun']);

  // Drag Luzern below Bern.
  const grip = page.getByRole('button', { name: /Move Luzern/ });
  const box = (await grip.boundingBox())!;
  const bern = (await page.getByRole('button', { name: /Move Bern/ }).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, bern.y + bern.height, { steps: 8 });
  await page.mouse.up();
  await expect.poll(names).toEqual(['Zürich HB', 'Bern', 'Luzern', 'Thun']);

  // Keyboard: Thun up by one, focus stays on its grip.
  await page.getByRole('button', { name: /Move Thun/ }).focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(names).toEqual(['Zürich HB', 'Bern', 'Thun', 'Luzern']);
  await expect(page.getByRole('button', { name: /Move Thun/ })).toBeFocused();
  // Start and end follow the order.
  await expect(page.locator('.line > li').last()).toHaveClass(/last/);
});
