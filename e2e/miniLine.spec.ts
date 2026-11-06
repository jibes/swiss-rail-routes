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
  const line = page.locator('.mini-line').first();
  await expect(line).toBeVisible();

  for (const width of [360, 1400]) {
    await page.setViewportSize({ width, height: 800 });
    // Wide, the list is a column of its own (drawn anew).
    await expect(line).toBeVisible();
    const box = (await line.boundingBox())!;
    const dots = await line.locator('b').evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x + r.width / 2, w: r.width, h: r.height };
      }),
    );
    expect(dots.length).toBeGreaterThan(1);
    for (const d of dots) expect(d.w).toBe(d.h);
    expect(dots[0]!.x - box.x).toBeLessThan(dots[0]!.w);
    expect(box.x + box.width - dots.at(-1)!.x).toBeLessThan(dots[0]!.w);
    const gaps = dots.slice(1).map((d, i) => d.x - dots[i]!.x);
    for (const g of gaps) expect(Math.abs(g - gaps[0]!)).toBeLessThan(1.5);
  }
});
