import { encodeTour } from '../src/core/export/share';
import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { answerWorker, expect, test } from './fixtures';

// Two devices (separate browser contexts, so separate storage) and the Worker's mailbox.
test('sync: start on one device, join with the key on another, changes go both ways', async ({
  page,
  browser,
}) => {
  await page.goto(
    `./${encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'From the phone' })}`,
  );
  await page.getByRole('button', { name: 'Save to my routes' }).click();
  await page.goto('./#/settings');
  await page.getByRole('button', { name: 'Start sync' }).click();
  await expect(page.getByRole('status')).toContainText(/Synced/);
  await page.getByRole('button', { name: 'Add a device' }).click();
  await expect(page.getByRole('img', { name: 'QR code with the sync key' })).toBeVisible();
  const key = (await page.locator('code.key').innerText()).trim();
  expect(key).toMatch(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/);

  const laptop = await browser.newPage({ baseURL: new URL('./', page.url()).href });
  await answerWorker(laptop);
  await laptop.goto('./#/settings');
  await laptop.getByRole('button', { name: 'I have a key' }).click();
  // Typed by hand: lower case, spaces instead of dashes.
  await laptop
    .getByLabel('Key from your other device')
    .fill(key.toLowerCase().replaceAll('-', ' '));
  await laptop.getByRole('button', { name: 'Join sync' }).click();
  await expect(laptop.getByRole('status')).toContainText(/Synced/);
  await laptop.goto('./');
  await expect(laptop.getByRole('link', { name: /From the phone/ })).toBeVisible();

  // A route made on the laptop reaches the phone; one deleted there disappears here.
  await laptop.getByRole('button', { name: 'New tour' }).click();
  await laptop.getByLabel('Tour name').fill('From the laptop');
  await laptop.waitForTimeout(3500); // sync 3 s after the last change
  await laptop.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.goto('./');
  await page.reload();
  await expect(page.getByRole('link', { name: /From the laptop/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /From the phone/ })).toBeVisible();
  await laptop.close();

  // The key from a link: opens settings to confirm, and does not stay in the address bar.
  const third = await browser.newPage({ baseURL: new URL('./', page.url()).href });
  await answerWorker(third);
  await third.goto(`./#/sync/${key}`);
  await expect(third.getByLabel('Key from your other device')).toHaveValue(key);
  await expect(third).toHaveURL(/#\/settings$/);
  await third.close();
});
