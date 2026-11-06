import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { encodeTour } from '../tests/helpers/share';
import { BEFORE, expect, planShared, test } from './fixtures';

// ⋯ → Prices on SBB: each leg as a link to sbb.ch's own timetable, its stops by number.
test('prices on SBB: each leg opens sbb.ch with its stops, date and time', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'Prices' }));
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Prices on SBB' }).click();
  const sheet = page.getByRole('dialog', { name: 'Prices on SBB' });
  const link = sheet.getByRole('link').first();
  await expect(link).toContainText('Interlaken Ost → Kleine Scheidegg');
  const url = new URL((await link.getAttribute('href'))!);
  expect(url.origin).toBe('https://www.sbb.ch');
  expect(url.searchParams.get('stops')).toBe('Interlaken Ost_I8507492~Kleine Scheidegg_I8507374');
  expect(url.searchParams.get('moment')).toBe('dep');
  expect(url.searchParams.get('date')).toBe(`"${FIXTURE_DATE}"`);
  expect(await link.getAttribute('target')).toBe('_blank');
});

// Show prices: the cheapest tickets of each leg, without and with Half Fare, asked on the tap.
test('show prices: each leg’s cheapest tickets from SBB’s fare service', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'Prices' }));
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Prices on SBB' }).click();
  const sheet = page.getByRole('dialog', { name: 'Prices on SBB' });
  await expect(sheet.getByText(/Asking the fare service/)).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Show prices' }).click();
  await expect(sheet.getByRole('button', { name: 'Show prices' })).toHaveCount(0);
  await expect(
    sheet.getByText(/^2nd class CHF \d+\.\d\d · Half Fare CHF \d+\.\d\d/).first(),
  ).toBeVisible();
  await expect(sheet.getByText(/Asking the fare service/)).toHaveCount(0);
});
