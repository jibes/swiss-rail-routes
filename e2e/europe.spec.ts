import { BEFORE, expect, newTrip, test } from './fixtures';

// Europe (0.33.0): a station abroad found by name (Transitous, asked as you type since 0.66.1),
// and the leg to it planned by Transitous; the GA ends at the border, and it says so.
test('a station abroad: found as you type, planned there, the GA said to end at the border', async ({
  page,
}) => {
  await page.clock.install({ time: BEFORE });
  await newTrip(page, 'Zürich HB');
  await page.getByRole('button', { name: 'Add a station' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByPlaceholder('Station, scenic line or past trip').fill('München Hbf');
  // Asked once the text rests, under the Swiss ones, no tap first (13 Nov 2026).
  await expect(sheet.getByRole('heading', { name: 'Abroad' })).toBeVisible();
  await sheet
    .getByRole('button', { name: /^München Hbf/ })
    .first()
    .click();
  const line = page.getByRole('list', { name: 'The trip' });
  await expect(line.locator('li.station').filter({ hasText: 'München Hbf' })).toHaveCount(1);
  // Planned through Transitous: the train and the GA's end.
  await expect(page.getByText(/not covered by GA or day pass/).first()).toBeVisible({
    timeout: 15_000,
  });
});
