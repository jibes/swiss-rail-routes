// Print: one page of the trip, nothing to tap on it (src/styles/print.css).
import { encodeTour } from '../tests/helpers/share';
import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { BEFORE, expect, planShared, test } from './fixtures';

const tours = acceptanceTours(FIXTURE_DATE);

test('a trip printed: its name, times and line, no controls', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  await planShared(page, encodeTour({ ...tours.T5!, name: 'T5' }));
  // The menu offers it and calls the browser's own print.
  await page.evaluate(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => void (window as unknown as { printed: number }).printed++;
  });
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Print' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed))
    .toBe(1);
  await expect(page.locator('.menu-scrim')).toHaveCount(0);

  await page.emulateMedia({ media: 'print' });
  for (const sel of ['.bar', '.options-bar', '.trip-line .addrow'])
    await expect(page.locator(sel).first(), sel).toBeHidden();
  await expect(page.locator('.hero-times')).toBeVisible();
  await expect(page.locator('.trip-line .ride').first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('T5');
  // Black on white, dark mode or not.
  await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
  const ground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(ground).toBe('rgb(255, 255, 255)');
});

// A4 in Chromium: a usual day (T5: Interlaken – Kleine Scheidegg and back) on one page; the
// longest days, T3 (11 rides) and T1 (14 rides, 12 changes), on two.
for (const [id, most] of [
  ['T5', 1],
  ['T3', 2],
  ['T1', 2],
] as const)
  test(`${id} prints on at most ${most} page(s)`, async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium' || isMobile, 'PDF in desktop Chromium only');
    await page.clock.install({ time: BEFORE });
    await planShared(page, encodeTour({ ...tours[id]!, name: id }));
    await page.emulateMedia({ media: 'print' });
    const raw = await page.pdf({ format: 'A4', printBackground: false });
    const pdf = raw.toString('latin1');
    const pages = pdf.match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0;
    expect(pages).toBeLessThanOrEqual(most);
    expect(pages).toBeGreaterThan(0);
  });
