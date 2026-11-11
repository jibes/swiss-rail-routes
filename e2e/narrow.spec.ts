// The line at 360 px, the narrowest phone width we draw for (third audit, 11 Nov 2026).
import { encodeTour } from '../tests/helpers/share';
import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { BEFORE, expect, planShared, test } from './fixtures';

test.use({ viewport: { width: 360, height: 780 } });

test('at 360 px every ride keeps its kind, and nothing runs under the weather stripe', async ({
  page,
}) => {
  await page.clock.install({ time: BEFORE });
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T1!, name: 'T1' }));
  // The kind of train, a word wide at least (it was 0 px: `min(max-content, 9em)` is no valid
  // min-width, so the rule was dropped).
  const kinds = page.locator('.trip-line .ride .ride-l1 > .product');
  await expect(kinds.first()).toBeVisible();
  const widths = await kinds.evaluateAll((els) =>
    els.map((e) => [e.textContent ?? '', e.getBoundingClientRect().width] as const),
  );
  for (const [text, w] of widths) if (text.trim()) expect(w, text).toBeGreaterThan(20);
  // The stay chips end before the weather stripe starts.
  const clear = await page.evaluate(() => {
    const stripe = document.querySelector('.wx-cell')?.getBoundingClientRect().left ?? Infinity;
    return [...document.querySelectorAll('.trip-line .chip')].every(
      (c) => c.getBoundingClientRect().right <= stripe,
    );
  });
  expect(clear).toBe(true);
});
