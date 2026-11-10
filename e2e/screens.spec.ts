// Screenshots for design review: SCREENSHOTS=dir npx playwright test e2e/screens.spec.ts --project=phone
import { encodeTour } from '../tests/helpers/share';
import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { BEFORE, expect, planShared, test } from './fixtures';

const dir = process.env.SCREENSHOTS;
test.skip(!dir, 'only with SCREENSHOTS=<dir>');

for (const scheme of ['light', 'dark'] as const) {
  test(`screens ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const shot = (name: string, full = false) =>
      page.screenshot({ path: `${dir}/${scheme}-${name}.png`, fullPage: full });
    await page.clock.install({ time: BEFORE });
    const t3 = { ...acceptanceTours(FIXTURE_DATE).T3!, name: 'Voralpen-Express + Brünig' };
    await planShared(page, encodeTour(t3));
    await page.locator('.trip-line .ride').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await shot('2-trip');
    await shot('2-trip-full', true);
    await page.locator('.trip-line .station.entry').nth(2).getByRole('button').first().click();
    await page.getByRole('button', { name: 'Stay', exact: true }).click();
    await page.locator('.panel').scrollIntoViewIfNeeded();
    await shot('3-panel');
    await page.getByRole('button', { name: 'Add a station' }).click();
    await shot('3-add');
    await page.goto('./');
    await page.getByRole('button', { name: 'New trip' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await shot('1-home');
  });

  test(`now ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.clock.install({ time: new Date(`${FIXTURE_DATE}T07:50:00Z`) }); // planned at 08:50
    const t5 = { ...acceptanceTours(FIXTURE_DATE).T5!, name: 'Kleine Scheidegg' };
    await planShared(page, encodeTour(t5));
    // 09:15, on the R62 (a trip is never planned from a time gone).
    await page.clock.runFor('25:00');
    await page.locator('.trip-line .ride.here').waitFor();
    await page.screenshot({ path: `${dir}/${scheme}-4-now.png` });
    await page
      .getByRole('list', { name: 'The trip', exact: true })
      .locator('.station', { hasText: 'Kleine Scheidegg' })
      .locator('button.m')
      .click();
    await page.locator('.trip-line.past').waitFor();
    // Planned at once (the rest from here may have no recorded answer: then its notice).
    await page
      .getByRole('button', { name: 'Update trip' })
      .or(page.getByRole('alert'))
      .first()
      .waitFor({ timeout: 30_000 });
    await page.screenshot({ path: `${dir}/${scheme}-6-replan.png` });
    await page.goto('./#/');
    await page.locator('.livebar').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${dir}/${scheme}-5-list-live.png` });
    expect(true).toBe(true);
  });
}
