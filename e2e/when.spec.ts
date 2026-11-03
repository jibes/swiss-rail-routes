import { BEFORE, expect, newTrip as open, test } from './fixtures';

/** A new trip, today from the next five minutes (Mon 2 Nov, 09:05 in Zurich). */
const newTrip = async (page: import('@playwright/test').Page) => {
  await page.clock.install({ time: BEFORE });
  await open(page);
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Leave from (time)')).toHaveValue('09:05');
};

const saved = (page: import('@playwright/test').Page) => page.locator('.when-field');

test('a time later today can be typed, digit by digit', async ({ page, isMobile }) => {
  test.skip(isMobile, 'a phone opens its own picker');
  await newTrip(page);
  const time = page.getByLabel('Leave from (time)');
  await time.focus();
  // 01:05 on the way must not snap back to now and lose the typing, even after a pause.
  await page.keyboard.press('1');
  await page.clock.runFor(1000);
  await page.keyboard.press('4');
  await page.keyboard.press('3');
  await page.keyboard.press('0');
  await expect(time).toHaveValue('14:30');
  await expect(saved(page).last()).toHaveText('from 14:30');
});

test('a time gone today becomes now once finished, not on the way', async ({ page, isMobile }) => {
  test.skip(isMobile, 'a phone opens its own picker');
  await newTrip(page);
  const time = page.getByLabel('Leave from (time)');
  await time.focus();
  await page.keyboard.press('0');
  await page.keyboard.press('7');
  await page.clock.runFor(1000);
  await expect(saved(page).last()).toHaveText('from 07:05');
  await page.getByLabel('Date').focus();
  await expect(time).toHaveValue('09:00');
});

test('picked from the system picker, a time gone becomes now by itself', async ({ page }) => {
  await newTrip(page);
  const time = page.getByLabel('Leave from (time)');
  await time.fill('07:00');
  await page.clock.runFor(1000);
  await expect(time).toHaveValue('09:00');
});

test('a day gone is refused, the trip keeps its day', async ({ page }) => {
  await newTrip(page);
  const date = page.getByLabel('Date');
  await date.fill('2026-10-01');
  await date.blur();
  await expect(date).toHaveValue('2026-11-02');
  await expect(saved(page).first()).toHaveText('Mon, Nov 2');
});

test('a day in another year says its year', async ({ page }) => {
  await newTrip(page);
  await page.getByLabel('Date').fill('2027-01-09');
  await page.clock.runFor(1000);
  await expect(saved(page).first()).toHaveText('Sat, Jan 9, 2027');
});

test('moved back to today, a time gone becomes the next few minutes', async ({ page }) => {
  await newTrip(page);
  const date = page.getByLabel('Date');
  const time = page.getByLabel('Leave from (time)');
  await date.fill('2026-11-07');
  await page.clock.runFor(1000);
  await time.fill('07:00');
  await page.clock.runFor(1000);
  await expect(time).toHaveValue('07:00');
  await date.fill('2026-11-02');
  await page.clock.runFor(1000);
  await expect(time).toHaveValue('09:05');
});

test('a value still resting is saved when leaving the screen', async ({ page }) => {
  await newTrip(page);
  await page.getByLabel('Date').fill('2026-11-07');
  const trip = new URL(page.url()).hash;
  await page.evaluate(() => (location.hash = '#/settings'));
  await expect(page.getByLabel('Date')).toHaveCount(0);
  await page.evaluate((h) => (location.hash = h), trip);
  await expect(page.getByLabel('Date')).toHaveValue('2026-11-07');
});

test('a click anywhere on a pill opens the picker with a mouse', async ({ page, isMobile }) => {
  test.skip(isMobile, 'a touch opens it by itself');
  await newTrip(page);
  await page.evaluate(() => {
    (window as unknown as { picked: string[] }).picked = [];
    HTMLInputElement.prototype.showPicker = function () {
      (window as unknown as { picked: string[] }).picked.push(this.type);
    };
  });
  await page.getByLabel('Date').click({ position: { x: 12, y: 12 } });
  await page.getByLabel('Leave from (time)').click({ position: { x: 12, y: 12 } });
  expect(await page.evaluate(() => (window as unknown as { picked: string[] }).picked)).toEqual([
    'date',
    'time',
  ]);
});
