// Screenshots for design review: SCREENSHOTS=dir npx playwright test e2e/screens.spec.ts --project=phone
import { encodeTour } from '../src/core/export/share';
import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { expect, test } from './fixtures';

const dir = process.env.SCREENSHOTS;
test.skip(!dir, 'only with SCREENSHOTS=<dir>');

for (const scheme of ['light', 'dark'] as const) {
  test(`screens ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const shot = (name: string, full = false) =>
      page.screenshot({ path: `${dir}/${scheme}-${name}.png`, fullPage: full });
    const t3 = { ...acceptanceTours(FIXTURE_DATE).T3!, name: 'Voralpen-Express + Brünig' };
    await page.goto(`./${encodeTour(t3)}`);
    await page.getByRole('button', { name: 'Save to my tours' }).click();
    await page.waitForTimeout(300);
    await shot('2-builder');
    await shot('2-builder-full', true);
    await page.getByRole('button', { name: 'Plan' }).click();
    await page.locator('.chain > .leg').first().waitFor();
    await page.waitForTimeout(300);
    await shot('3-timeline');
    await shot('3-timeline-full', true);
    await page.goto('./');
    await page.waitForTimeout(300);
    await shot('1-home');
    expect(true).toBe(true);
  });
}
