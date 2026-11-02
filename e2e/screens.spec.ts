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
    await page.waitForTimeout(300);
    await shot('2-trip');
    await shot('2-trip-full', true);
    await page.locator('.trip-line .station.entry').nth(2).getByRole('button').first().click();
    await page.getByRole('button', { name: 'Stay', exact: true }).click();
    await page.locator('.panel').scrollIntoViewIfNeeded();
    await shot('3-panel');
    await page.getByRole('button', { name: 'Add a station' }).click();
    await shot('3-add');
    await page.goto('./');
    await page.waitForTimeout(300);
    await shot('1-home');
  });

  test(`now ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.clock.install({ time: new Date(`${FIXTURE_DATE}T08:15:00Z`) }); // 09:15 Zürich
    const t5 = { ...acceptanceTours(FIXTURE_DATE).T5!, name: 'Kleine Scheidegg' };
    await planShared(page, encodeTour(t5));
    await page.locator('.row.ride.here').waitFor();
    await page.screenshot({ path: `${dir}/${scheme}-4-now.png` });
    await page.getByRole('link', { name: 'Replan from here' }).click();
    await page.locator('.trip-line.past').waitFor();
    // Planned at once (the rest from here may have no recorded answer: then its notice).
    await page
      .getByRole('button', { name: 'Update trip' })
      .or(page.getByRole('alert'))
      .first()
      .waitFor({ timeout: 30_000 });
    await page.screenshot({ path: `${dir}/${scheme}-6-replan.png` });
    await page.goBack();
    await page.goto('./#/');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/${scheme}-5-list-live.png` });
    expect(true).toBe(true);
  });
}
