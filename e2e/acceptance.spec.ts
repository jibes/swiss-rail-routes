// T1–T6 through the real UI: route link → trip → every option → calendar → map.
import { readFileSync } from 'node:fs';
import { encodeTour } from '../tests/helpers/share';
import { FIXTURE_DATE } from '../tests/acceptance/ojp';
import { acceptanceTours } from '../tests/acceptance/tours';
import { BEFORE, expect, planShared, test } from './fixtures';

const tours = acceptanceTours(FIXTURE_DATE);

for (const [id, tour] of Object.entries(tours).filter(([k]) => k !== 'T5L')) {
  test(`${id} plans in the app`, async ({ page }) => {
    await page.clock.install({ time: BEFORE });
    await planShared(page, encodeTour({ ...tour, name: id }));
    await expect(page.getByRole('alert')).toHaveCount(0);
    // T1 on the recorded day: replacement buses on the Albula line stop outside the stations
    // ("Bergün/Bravuogn, posta"); the stations still count as reached, none struck.
    if (id === 'T1') {
      await expect(
        page.locator('.trip-line .station', { hasText: 'Bergün' }).first(),
      ).toBeVisible();
      await expect(page.locator('.trip-line .station.missed')).toHaveCount(0);
      // Each train says where it goes, as on the boards (left out where it ends where you get off).
      await expect(page.locator('.trip-line .ride .towards').first()).toContainText('→ ');
      // Platforms beside the stations' names (0.50.0): where you board at the start, both at a
      // change (arriving, then leaving), where you get off before walking on (Thusis).
      const station = (name: RegExp) =>
        page
          .locator('.trip-line > li.station')
          .filter({ has: page.locator('.n', { hasText: name }) });
      await expect(
        station(/^Zürich HB/)
          .first()
          .locator('.pl-at')
          .first(),
      ).toHaveText(/^Pl\. /);
      const chur = station(/^Chur/);
      await expect(chur.locator('.pl-at')).toHaveCount(2);
      await expect(station(/^Thusis(?!,)/).locator('.pl-at')).toHaveCount(1);
      // Never on the train's row, nor at a station a train passes.
      await expect(page.locator('.trip-line .ride .ride-l1 .pl')).toHaveCount(0);
      await expect(page.locator('.trip-line .ride .pl-at')).toHaveCount(0);
      // Along the Albula and Bernina lines: which side to sit on, on the ride.
      await expect(page.locator('.trip-line .ride .seat').first()).toBeVisible();
      // The bus passes Bergün by walking to the station and back: one row, arriving and leaving,
      // not two walks around an untimed station.
      await expect(page.locator('.trip-line .station', { hasText: 'Bergün' })).toHaveCount(1);
      await expect(page.getByText('Walk 8 min')).toHaveCount(0);
    }

    // 2–3 options with different times, the recommended one chosen; or one with a note.
    const opts = page.getByRole('group', { name: 'Alternatives' }).getByRole('button');
    const n = await opts.count();
    if (n) {
      const labels = await opts.allInnerTexts();
      expect(new Set(labels.map((l) => l.split('\n')[0])).size, 'distinct times').toBe(n);
      await expect(page.locator('.opt[aria-pressed="true"] .best')).toHaveCount(1);
    } else await expect(page.getByText(/Only one connection/)).toBeVisible();
    for (let i = 0; i < Math.max(n, 1); i++) {
      if (n) {
        await opts.nth(i).click();
        await expect(opts.nth(i)).toHaveAttribute('aria-pressed', 'true');
      }
      // Each option's line holds its trains: as many as the option's strip says it changes, plus one.
      const changes = Number(
        (await page.locator('.facts').innerText()).match(/(\d+) change/)?.[1] ?? 0,
      );
      expect(await page.locator('.trip-line .ride .run-open').count()).toBeGreaterThanOrEqual(
        changes + 1,
      );
    }
    // T3 walks (Interlaken Ost to its bus stop, Thun): a walk's rail is dashed, a ride's solid.
    if (id === 'T3') {
      const rail = (sel: string) =>
        page
          .locator(sel)
          .first()
          .evaluate(
            (li) => getComputedStyle(li.querySelector('.rail')!, '::before').backgroundImage,
          );
      expect(await rail('.trip-line .ride.walk')).toContain('radial-gradient');
      expect(await rail('.trip-line .ride:not(.walk)')).toBe('none');
    }

    // The calendar from the menu: one event per train; the map shows the trip and goes back.
    const rides = await page.locator('.trip-line .ride:not(.walk)').count();
    await page.getByRole('button', { name: 'More' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Calendar/ }).click();
    const ics = readFileSync((await (await download).path())!, 'utf8');
    expect(ics.match(/^BEGIN:VEVENT/gm)?.length, 'events in the .ics').toBe(rides);
    expect(ics).toContain('END:VCALENDAR');
    await page.getByRole('button', { name: 'Map' }).click();
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page).toHaveURL(/#\/trip\//);
    await expect(page.locator('.trip-line .ride').first()).toBeVisible();
  });
}

test('more options that fail to load change nothing; a tap chooses one', async ({ page }) => {
  await page.clock.install({ time: BEFORE });
  await planShared(page, encodeTour({ ...tours.T5!, name: 'T5' }));
  const opts = page.getByRole('group', { name: 'Alternatives' }).getByRole('button');
  const n = await opts.count();
  const hero = (await page.locator('.hero-times').textContent()) ?? '';
  // The service not answering: the bar says it could not load more, and the trip and its
  // options stay as they were (a load that comes becomes the trip: plan.spec). While it loads,
  // the strip grows: it scrolls itself, never the page sideways.
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route(/\/trip$/, async (route) => {
    await held;
    await route.abort();
  });
  await page.getByRole('button', { name: 'Later connections' }).click();
  await expect(page.locator('.opt.loading')).toBeVisible();
  // As many options as a day of loading gives (copies of the first): the strip scrolls, the
  // page keeps the screen's width (on a phone the page itself would grow, so `innerWidth` is
  // measured against the device's width, not the page's), and the arrows stay at the strip's
  // ends however it is scrolled (audit, 11 Nov 2026: at 360 px "Later" began out of view).
  const width = page.viewportSize()!.width;
  const fits = await page.evaluate(() => {
    const strip = document.querySelector('.options-bar .opts')!;
    const list = strip.querySelector('.opts-list')!;
    const first = list.querySelector('.opt')!;
    for (let i = 0; i < 8; i++) {
      const copy = first.cloneNode(true) as HTMLElement;
      copy.dataset.copy = '';
      list.appendChild(copy);
    }
    const [earlier, later] = [...strip.querySelectorAll<HTMLElement>(':scope > .shift')];
    const box = strip.getBoundingClientRect();
    const inView = () => {
      const [e, l] = [earlier!.getBoundingClientRect(), later!.getBoundingClientRect()];
      return e.left >= box.left - 1 && l.right <= box.right + 1 && l.left > e.right;
    };
    strip.scrollLeft = 0;
    const atStart = inView();
    strip.scrollLeft = strip.scrollWidth;
    const atEnd = inView();
    strip.scrollLeft = 0;
    const page = document.querySelector('.page')!.getBoundingClientRect();
    return {
      inner: innerWidth,
      scroll: document.documentElement.scrollWidth,
      bar: document.querySelector('.options-bar')!.getBoundingClientRect().right <= page.right,
      scrolls: strip.scrollWidth > strip.clientWidth,
      arrows: !!earlier && !!later && atStart && atEnd,
    };
  });
  expect(fits, 'no sideways page scroll').toEqual({
    inner: width,
    scroll: width,
    bar: true,
    scrolls: true,
    arrows: true,
  });
  await page.evaluate(() => document.querySelectorAll('[data-copy]').forEach((x) => x.remove()));
  release();
  await expect(page.getByText('Could not load more connections.')).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.locator('.options-note').getByRole('button', { name: 'Try again' }),
  ).toBeVisible();
  await expect(opts).toHaveCount(n);
  await expect(page.locator('.hero-times')).toHaveText(hero);
  // Another option becomes the trip at once (no new request), the others stay to choose from.
  if (n > 1) {
    const other = opts.filter({ hasNot: page.locator('.best') }).first();
    const time = (await other.innerText()).split('\n')[0]!.trim();
    await other.click();
    await expect(page.locator('.hero-times')).toContainText(time);
    await expect(opts).toHaveCount(n);
  }
});
