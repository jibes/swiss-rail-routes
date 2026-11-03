import { encodeTour } from '../tests/helpers/share';
import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { BEFORE, expect, pick, planShared, test } from './fixtures';

// T5 (Interlaken Ost 09:04 → Kleine Scheidegg), lived through with a controlled clock.
// Live calls (/journey) are not recorded: the screen falls back to timetable times.
test('a trip under way: next step, progress, the marker on the line', async ({ page }) => {
  await page.clock.install({ time: new Date(`${FIXTURE_DATE}T07:50:00Z`) }); // 08:50 in Zürich
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'T5' }));

  // Before departure.
  await expect(page.getByText('Departure', { exact: true })).toBeVisible();
  await expect(page.getByText('in 14 min')).toBeVisible();
  await expect(page.locator('.trip-line .station.here')).toHaveCount(1);
  // Not left yet: another connection can still be taken.
  await expect(page.getByRole('group', { name: 'Alternatives' })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  // 09:03:30, the train in half a minute: nothing leaves before it from now, so Earlier finds
  // none and the trip stays as it is (choosing a connection gone would end it at once).
  await page.clock.runFor('13:30');
  const hero = await page.locator('.next-time .num').innerText();
  await page.getByRole('button', { name: 'Earlier connections' }).click();
  await expect(page.locator('.options-note')).toHaveText('No earlier connection on this day.');
  await expect(page.locator('.next-time .num')).toHaveText(hero);
  await expect(page.locator('.trip-line .station.here')).toHaveCount(1);

  // On the train: the marker rides along, its stops open, passed ones grey.
  await page.clock.runFor('11:30');
  await expect(page.getByText(/Get off at Lauterbrunnen|Get off at Grindelwald/)).toBeVisible();
  await expect(page.locator('.trip-line .ride.here')).toHaveCount(1);
  await expect(page.getByRole('group', { name: 'Alternatives' })).toHaveCount(0);
  await expect(page.locator('.trip-line .ride.here .mids li').first()).toBeVisible();
  await expect(page.locator('.here-mid')).toHaveCount(1);
  await expect(page.locator('.here-mid')).toHaveText('You are here');
  // The marker sits on the rail between the stop before and the one after it.
  const marker = await page.evaluate(() => {
    const row = document.querySelector('.trip-line .ride.here')!;
    const dot = getComputedStyle(row.querySelector('.rail')!, '::after');
    const rail = row.querySelector('.rail')!.getBoundingClientRect();
    const y = rail.top + parseFloat(dot.top) + parseFloat(dot.height) / 2;
    const mid = row.querySelector('.here-mid')!;
    const box = (e: Element | null) => e?.getBoundingClientRect();
    const before = box(mid.previousElementSibling);
    const after = box(mid.nextElementSibling);
    return {
      y,
      from: before ? before.top + before.height / 2 : rail.top,
      to: after ? after.top + after.height / 2 : rail.bottom,
    };
  });
  expect(marker.y).toBeGreaterThanOrEqual(marker.from - 1);
  expect(marker.y).toBeLessThanOrEqual(marker.to + 1);
  await expect(page.locator('.trip-line.live .passed').first()).toBeVisible();
  expect(Number(await page.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeGreaterThan(
    0,
  );

  // The lists show the live bar; opening the app goes straight to Now.
  await page.goto('./#/trips');
  await expect(page.locator('.livebar')).toBeVisible();
  await page.goto('./');
  await expect(page).toHaveURL(/#\/trip\/[\w-]+$/);
  // A reload stays where it was (only opening the app goes to the trip under way).
  await page.goto('./#/trips');
  await page.goto('./#/');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Under way');
});

test('replan from here: a spontaneous stop, update the trip, undo', async ({ page }) => {
  await page.clock.install({ time: new Date(`${FIXTURE_DATE}T07:50:00Z`) }); // planned at 08:50
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'T5' }));
  // 09:15, on the R62 (a trip is never planned from a time gone).
  await page.clock.runFor('25:00');

  await page.getByRole('link', { name: 'Replan from here' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('From Zweilütschinen');
  // The rest from here is planned at once, without a failure first.
  await expect(page.getByRole('button', { name: 'Update trip' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  // Nothing changed yet: nothing to update. The way here, grey, above the rest.
  await expect(page.getByRole('button', { name: 'Update trip' })).toBeDisabled();
  await expect(page.locator('.trip-line.past .ride')).toHaveCount(1);
  await expect(page.locator('.trip-line.past .station')).toHaveText([/Interlaken Ost/]);
  // The same line as the trip screen; where you are is fixed: only "Add after".
  const line = page.getByRole('list', { name: 'The trip', exact: true });
  await line.locator('.station.entry').first().getByRole('button').first().click();
  await expect(page.getByRole('combobox', { name: 'Station' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add after' }).click();
  await pick(page, 'Wengen');

  const wengen = line.locator('.station.entry', { hasText: 'Wengen' });
  await wengen.getByRole('button', { name: /^Wengen/ }).click();
  await page.getByRole('button', { name: 'Stay', exact: true }).click();
  // Planned as you edit: no Find button, Update once the plan is there.
  await expect(page.getByRole('button', { name: 'Find connections' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Update trip' })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Update trip' }).click({ timeout: 30_000 });

  // Back on Now: the new plan (via Wengen), undo available.
  await expect(page).toHaveURL(/#\/trip\/[\w-]+$/);
  await expect(line.locator('.station.entry', { hasText: 'Wengen' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await expect(line).not.toContainText('Wengen');
});

test('before departure: edited in place; after its day: in search', async ({ page }) => {
  await page.clock.install({ time: new Date(`${FIXTURE_DATE}T05:00:00Z`) }); // 06:00, hours before
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T5!, name: 'T5' }));

  // Before departure: the timetable, every station a button for the panel; nothing live.
  await expect(page.locator('.hero-times')).toContainText('09:04');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.locator('.trip-line .station.entry').first().getByRole('button').first().click();
  await expect(page.getByRole('button', { name: 'Add after' })).toBeVisible();
  await page.goto('./');
  await expect(page.getByRole('list', { name: 'Upcoming' }).getByRole('link')).toHaveCount(1);

  // The day after: gone from the list, T5 waits in search.
  await page.clock.setSystemTime(new Date(`2026-11-08T08:00:00Z`));
  await page.reload();
  await expect(page.getByRole('list', { name: 'Upcoming' })).toHaveCount(0);
  await page.getByRole('button', { name: 'New trip' }).click();
  await expect(page.getByRole('button', { name: /^T5/ })).toBeVisible();
});

// T3 walks at Interlaken Ost and Thun: once passed, the stations beside a walk are grey all
// along their rail, not red where it is solid (they were, as fragments on the grey line).
test('under way, the stations beside a walk passed are grey', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  await planShared(page, encodeTour({ ...acceptanceTours(FIXTURE_DATE).T3!, name: 'T3' }));
  const [, arr] = (await page.locator('.hero-times').innerText()).match(/\d\d:\d\d/g)!;
  const end = Date.parse(`${FIXTURE_DATE}T${arr}:00+01:00`);
  await page.clock.fastForward(end - 20 * 60_000 - BEFORE.getTime());
  await expect(page.locator('.trip-line.live')).toBeVisible();
  const passed = page.locator('.trip-line.live .station.passed:is(.walk-from, .walk-to)');
  await expect(passed.first()).toBeVisible();
  const red = await passed.evaluateAll((els) => {
    const probe = document.createElement('i');
    probe.style.color = 'var(--rail)';
    document.body.append(probe);
    const rail = getComputedStyle(probe).color;
    probe.remove();
    return els.filter((li) =>
      getComputedStyle(li.querySelector('.rail')!, '::before').backgroundImage.includes(rail),
    ).length;
  });
  expect(red).toBe(0);
  // The dots under the solid part are masked to its width, or they show as a bumpy second line.
  const masked = await passed.evaluateAll((els) =>
    els.every(
      (li) => getComputedStyle(li.querySelector('.rail')!, '::before').maskImage !== 'none',
    ),
  );
  expect(masked).toBe(true);
});
