// A station struck through: "Find one that works" tries the nearest stations that trains call
// at, one planner run each, and offers the first that reaches it; Use puts it in the route,
// Dismiss leaves the route alone. Answers: tests/fixtures/ojp/T7S (recorded with the
// acceptance test of the same name).
import { encodeTrip } from '../src/core/export/tripShare';
import { expandLegs } from '../src/core/tour';
import { newTrip } from '../src/core/trip';
import { addWaypoint, newTour } from '../tests/helpers/edit';
import { conn, DATE, ref, ride } from '../tests/helpers/timetable';
import type { Page } from '@playwright/test';
import { BEFORE, expect, test } from './fixtures';

/** St. Gallen → Wattwil → Bern → Luzern, saved with an IR that never reaches Bern. */
async function bernMissed(page: Page) {
  const st = (name: string) => ({ stopRef: ref(name), name });
  const tour = {
    ...addWaypoint(
      addWaypoint(addWaypoint(newTour('v', DATE, st('St. Gallen')), st('Wattwil')), st('Bern')),
      st('Luzern'),
    ),
    name: 'Bern missed',
  };
  const c = conn(
    ride('IR 1', [
      ['St. Gallen', '12:05'],
      ['Wattwil', '12:32'],
      ['Luzern', '14:21'],
    ]),
  );
  const chain = { connections: [c], warnings: [], score: 0, dep: c.dep, arr: c.arr };
  await page.clock.install({ time: BEFORE });
  await page.goto(
    `./${await encodeTrip(newTrip('v', tour, expandLegs(tour), chain, new Date(0)))}`,
  );
  await page.getByRole('button', { name: 'Save trip' }).click();
  await expect(page).toHaveURL(/#\/trip\//);
  const line = page.getByRole('list', { name: 'The trip' });
  await expect(line.locator('.station.missed')).toHaveText(/Bern/);
  return line;
}

test('a station missed: the nearest that works, used', async ({ page }) => {
  const line = await bernMissed(page);
  const note = line.locator('.missed-note');
  await note.getByRole('button', { name: 'Find one that works' }).click();
  await expect(note.getByRole('status')).toContainText(
    /Instead: Bern Weissenbühl, arrives \d\d:\d\d.*; skips Bern\./,
    { timeout: 30_000 },
  );
  await note.getByRole('button', { name: 'Use' }).click();
  // The route has it in Bern's place, and plans again: it is reached, nothing missed.
  await expect(line.locator('.station', { hasText: 'Bern Weissenbühl' }).first()).toBeVisible();
  await expect(line.locator('.station.missed')).toHaveCount(0, { timeout: 30_000 });
  await expect(line.locator('.station', { hasText: /^Bern$/ })).toHaveCount(0);
});

test('a station missed: a suggestion dismissed leaves the route as it was', async ({ page }) => {
  const line = await bernMissed(page);
  const note = line.locator('.missed-note');
  await note.getByRole('button', { name: 'Find one that works' }).click();
  await expect(note.getByRole('button', { name: 'Use' })).toBeVisible({ timeout: 30_000 });
  await note.getByRole('button', { name: 'Dismiss' }).click();
  await expect(note.getByRole('status')).toHaveCount(0);
  await expect(note.getByRole('button', { name: 'Find one that works' })).toHaveCount(0);
  await expect(line.locator('.station.missed')).toHaveText(/Bern/);
  await expect(line.locator('.station', { hasText: 'Bern Weissenbühl' })).toHaveCount(0);
});
