import { readFile } from 'node:fs/promises';
import { encodeTour } from '../tests/helpers/share';
import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { BEFORE, expect, planShared, test } from './fixtures';

test('debug log: opt in, plan a trip, save it as a file, never the sync key; off deletes it', async ({
  page,
}) => {
  await page.clock.install({ time: BEFORE });
  await page.goto('./#/settings');
  const toggle = page.getByRole('checkbox', { name: 'Keep a debug log' });
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Save file' })).toHaveCount(0);
  await toggle.check();
  await expect(page.getByText(/KB kept/)).toBeVisible();

  // Sync on, so the key exists: it must not reach the log.
  await page.getByRole('button', { name: 'Start sync' }).click();
  await expect(page.getByRole('status').first()).toContainText(/Synced/);
  await page.getByRole('button', { name: 'Add a device' }).click();
  const key = (await page.locator('code.key').innerText()).trim();

  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T4!, name: 'Rigi' }));

  await page.goto('./#/settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save file' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^viadukt-log-.*\.txt$/);
  const text = await readFile((await file.path())!, 'utf8');
  for (const event of [
    'log.on',
    'sync.start',
    'sync.ok',
    'screen',
    'plan.start',
    'ojp.trip',
    'plan.leg',
    'plan.result',
    'plan.done',
    'trip.rows',
  ])
    expect(text, event).toContain(` ${event} `);
  expect(text).toContain('Rigi Kulm');
  // Every line is "time event [json]".
  for (const line of text.trim().split('\n'))
    expect(line).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z [\w.]+( .+)?$/);
  expect(text).not.toContain(key);
  expect(text).not.toContain(key.replaceAll('-', ''));

  // Off: gone, and on again starts empty.
  await page.getByRole('checkbox', { name: 'Keep a debug log' }).uncheck();
  await expect(page.getByRole('button', { name: 'Save file' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Keep a debug log' }).check();
  const again = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save file' }).click();
  const fresh = await readFile((await (await again).path())!, 'utf8');
  expect(fresh).not.toContain('plan.start');
  expect(fresh).toContain(' log.on ');
});
