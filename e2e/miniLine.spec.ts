import { encodeTour } from '../tests/helpers/share';
import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { BEFORE, expect, planShared, test } from './fixtures';

test('the list’s mini line: round dots, evenly spaced, across the row at any width', async ({
  page,
}) => {
  await page.clock.install({ time: BEFORE });
  const tour = { ...acceptanceTours(FIXTURE_DATE).T5!, name: 'Dots' };
  await planShared(page, encodeTour(tour));
  await page.goto('./#/');
  await expect(page.locator('.mini-line').first()).toBeVisible();

  for (const width of [360, 1400]) {
    await page.setViewportSize({ width, height: 800 });
    // Wide, the list is a column of its own, drawn anew: measured once it has settled.
    await expect(async () => {
      // Line and dots measured in one go, in the page: never one before a redraw, one after.
      const { box, dots } = await page.evaluate(() => {
        const l = document.querySelector('.mini-line')!.getBoundingClientRect();
        return {
          box: { x: l.x, width: l.width },
          dots: [...document.querySelector('.mini-line')!.querySelectorAll('b')].map((e) => {
            const r = e.getBoundingClientRect();
            return { x: r.x + r.width / 2, w: r.width, h: r.height };
          }),
        };
      });
      expect(dots.length).toBeGreaterThan(1);
      for (const d of dots) expect(d.w).toBe(d.h);
      expect(dots[0]!.x - box.x).toBeLessThan(dots[0]!.w);
      expect(box.x + box.width - dots.at(-1)!.x).toBeLessThan(dots[0]!.w);
      const gaps = dots.slice(1).map((d, i) => d.x - dots[i]!.x);
      for (const g of gaps) expect(Math.abs(g - gaps[0]!)).toBeLessThan(1.5);
    }).toPass({ timeout: 5000 });
  }
});
