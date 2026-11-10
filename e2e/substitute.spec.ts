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

// Changing the rest under way has the same note: Use edits the rest, not the saved trip.
// Chur → Alvaneu → St. Moritz on 7 Nov 2026, the Albula closed Thusis–Preda (replacement buses do
// not serve Alvaneu): planned again from Landquart, Alvaneu is missed for real. Answers:
// tests/fixtures/ojp/T8R (recorded by the acceptance test of that name).
test('under way: a station missed, the nearest that works used in the rest', async ({ page }) => {
  const st = (name: string) => ({ stopRef: ref(name), name });
  const tour = {
    ...addWaypoint(addWaypoint(newTour('s', DATE, st('Chur')), st('Alvaneu')), st('St. Moritz')),
    name: 'Alvaneu',
  };
  const c = conn(
    ride('IR 1', [
      ['Chur', '08:00'],
      ['Landquart', '08:09'],
      ['St. Moritz', '10:12'],
    ]),
  );
  const chain = { connections: [c], warnings: [], score: 0, dep: c.dep, arr: c.arr };
  await page.clock.install({ time: new Date(`${DATE}T07:05:00Z`) }); // 08:05, on the IR
  await page.goto(
    `./${await encodeTrip(newTrip('s', tour, expandLegs(tour), chain, new Date(0)))}`,
  );
  await page.getByRole('button', { name: 'Save trip' }).click();
  await expect(page).toHaveURL(/#\/trip\//);
  const line = page.getByRole('list', { name: 'The trip', exact: true });
  await line.locator('.station', { hasText: 'St. Moritz' }).locator('button.m').click();
  await expect(line.locator('.station.missed')).toHaveText(/Alvaneu/, { timeout: 30_000 });
  const note = line.locator('.missed-note');
  await note.getByRole('button', { name: 'Find one that works' }).click();
  await expect(note.getByRole('status')).toContainText(/Instead: .+; skips Alvaneu\./, {
    timeout: 30_000,
  });
  const instead = /Instead: ([^,]+),/.exec((await note.getByRole('status').innerText()) ?? '')![1]!;
  await note.getByRole('button', { name: 'Use' }).click();
  // The rest has it in Alvaneu's place and plans again; the saved trip is not touched yet.
  await expect(line.locator('.station.entry', { hasText: instead }).first()).toBeVisible();
  await expect(line.locator('.station.missed')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Update trip' })).toBeEnabled({ timeout: 30_000 });
  // The way here stays as it was: Chur, never offered.
  await expect(page.locator('.trip-line.past .station').first()).toHaveText(/Chur/);
});
