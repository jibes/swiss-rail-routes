import { encodeTour } from '../tests/helpers/share';
import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { allowUnrecorded, BEFORE, expect, guard, newTrip, planShared, test } from './fixtures';

// Two devices (separate browser contexts, so separate storage) and the Worker's mailbox.
test('sync: start on one device, join with the key on another, changes go both ways', async ({
  page,
  browser,
}) => {
  await page.clock.install({ time: BEFORE });
  await planShared(
    page,
    encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'From the phone' }),
  );
  await page.goto('./#/settings');
  await page.getByRole('button', { name: 'Start sync' }).click();
  await expect(page.getByRole('status')).toContainText(/Synced/);
  await page.getByRole('button', { name: 'Add a device' }).click();
  await expect(page.getByRole('img', { name: 'QR code with the sync key' })).toBeVisible();
  const key = (await page.locator('code.key').innerText()).trim();
  expect(key).toMatch(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/);

  const laptop = await browser.newPage({ baseURL: new URL('./', page.url()).href });
  const laptopErrors = await guard(laptop);
  await laptop.clock.install({ time: BEFORE });
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

  // A trip made on the laptop reaches the phone; one deleted there disappears here (nothing is
  // recorded for Chur–Arosa: it syncs as a route without a timetable).
  allowUnrecorded(laptop);
  await newTrip(laptop, 'Chur', 'Arosa');
  await laptop.locator('h1 .title').click();
  await laptop.getByRole('textbox', { name: 'Name' }).fill('From the laptop');
  // Sync 3 s after the last change: wait for that write to be answered.
  const written = laptop.waitForResponse((r) => r.request().method() === 'PUT' && r.ok());
  await laptop.getByRole('textbox', { name: 'Name' }).press('Enter');
  await written;
  await laptop.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.goto('./');
  await page.reload();
  await expect(page.getByRole('link', { name: /From the laptop/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /From the phone/ })).toBeVisible();

  // An edit and a deletion of things both already have (the reported bug: neither went up).
  await page.getByRole('link', { name: /From the phone/ }).click();
  await page.locator('h1 .title').click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Renamed on the phone');
  await page.getByRole('textbox', { name: 'Name' }).press('Enter');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('link', { name: /From the laptop/ }).click();
  await page.getByRole('button', { name: 'More' }).click();
  const deleted = page.waitForResponse((r) => r.request().method() === 'PUT' && r.ok());
  await page.getByRole('button', { name: 'Delete trip' }).click();
  await deleted;
  await laptop.goto('./');
  await laptop.reload();
  await expect(laptop.getByRole('link', { name: /Renamed on the phone/ })).toBeVisible();
  await expect(laptop.getByRole('link', { name: /From the laptop/ })).toHaveCount(0);

  // Stations entered on the laptop come first on the phone too (0.48.1), its trip deleted.
  await page.goto('./');
  await page.getByRole('link', { name: /Renamed on the phone/ }).click();
  await page.getByRole('button', { name: 'Add a station' }).click();
  await expect(page.locator('.add-sheet .result.recent')).toContainText(['Arosa']);
  await page.getByRole('button', { name: 'Close' }).click();

  // A new key closes the old copy: the laptop, still on it, says so instead of refilling it.
  await page.goto('./#/settings');
  await page.getByRole('button', { name: 'New key' }).click();
  await page.getByRole('button', { name: /New key\?/ }).click();
  await expect(page.getByRole('status')).toContainText(/Synced/);
  await laptop.goto('./#/settings');
  await laptop.getByRole('button', { name: 'Sync now' }).click();
  await expect(laptop.getByRole('status')).toContainText(/replaced on another device/);
  // Said again after a restart, before any round has run (the last status is kept).
  await laptop.reload();
  await expect(laptop.getByRole('status')).toContainText(/replaced on another device/);
  laptopErrors.check();
  await laptop.close();

  // The key from a link: opens settings to confirm, and does not stay in the address bar.
  const third = await browser.newPage({ baseURL: new URL('./', page.url()).href });
  const thirdErrors = await guard(third);
  await third.clock.install({ time: BEFORE });
  await third.goto(`./#/sync/${key}`);
  await expect(third.getByLabel('Key from your other device')).toHaveValue(key);
  await expect(third).toHaveURL(/#\/settings$/);
  thirdErrors.check();
  await third.close();
});
