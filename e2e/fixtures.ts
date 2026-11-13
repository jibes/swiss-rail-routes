// Shared Playwright setup: every test fails on an uncaught page error or console.error, and the
// OJP Worker (the build's VITE_OJP_URL, https://ojp.invalid) is answered from the recorded
// acceptance answers (tests/fixtures/ojp/*/<sha1>.xml.gz, keyed like tests/acceptance/ojp.ts).
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, test as base, type Page } from '@playwright/test';
import { handle } from '../workers/ojp/src/handler';
import { syncHandle, type SyncRecord } from '../workers/ojp/src/sync';

const DIR = 'tests/fixtures/ojp';
// Trip answers by tour, and the map planner's departures (tests/fixtures/ojp/departures).
const tours = [...readdirSync(DIR).filter((d) => /^T\d/.test(d)), 'departures'];

export function recordedAnswer(body: string): string | null {
  const key = createHash('sha1').update(body).digest('hex').slice(0, 12);
  for (const t of tours) {
    const f = `${DIR}/${t}/${key}.xml.gz`;
    if (existsSync(f)) {
      if (process.env.FIXTURE_LOG) appendFileSync(process.env.FIXTURE_LOG, f + '\n');
      return gunzipSync(readFileSync(f)).toString('utf8');
    }
  }
  return null;
}

/** A Transitous answer (stations or a plan abroad) for the Worker's question (tests/fixtures/eu/e2e). */
export function recordedEu(body: string): string | null {
  const key = createHash('sha1').update(body).digest('hex').slice(0, 12);
  const f = `tests/fixtures/eu/e2e/${key}.json.gz`;
  if (!existsSync(f)) return null;
  if (process.env.FIXTURE_LOG) appendFileSync(process.env.FIXTURE_LOG, f + '\n');
  return gunzipSync(readFileSync(f)).toString('utf8');
}

/**
 * A forecast for the weather's question, made up and the same every time (no recording per
 * trip): sunny mornings clouding over, the third of every three places wet from 12:00 UTC.
 */
function madeUpWeather(url: string): Response {
  const q = new URL(url).searchParams;
  const lats = q.get('latitude')!.split(',');
  const days: string[] = [];
  for (
    let d = Date.parse(`${q.get('start_date')}T00:00:00Z`);
    d <= Date.parse(`${q.get('end_date')}T00:00:00Z`);
    d += 86_400_000
  )
    days.push(new Date(d).toISOString().slice(0, 10));
  const time = days.flatMap((d) =>
    Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, '0')}:00`),
  );
  const hour = (t: string) => Number(t.slice(11, 13));
  const one = (i: number) => ({
    hourly: {
      time,
      cloud_cover: time.map((t) => Math.min(100, Math.max(0, (hour(t) - 7) * 12))),
      precipitation_probability: time.map((t) =>
        i % 3 === 2 && hour(t) >= 12 && hour(t) < 16 ? 70 : 5,
      ),
      is_day: time.map((t) => (hour(t) >= 6 && hour(t) < 16 ? 1 : 0)),
      // Below zero early, at every place.
      temperature_2m: time.map((t) => hour(t) - 9 - i),
    },
  });
  const body = lats.length === 1 ? one(0) : lats.map((_, i) => one(i));
  return new Response(JSON.stringify(body), { status: 200 });
}

/** The sync mailbox, shared by every page of a run (ids are random per key). */
const boxes = new Map<string, SyncRecord>();

/** Pages whose tests mean a trip query without a recorded answer (the app's own failure path). */
const lenient = new WeakSet<Page>();

/**
 * A trip query the fixtures cannot answer fails the test, so a planner change that asks
 * something new is caught here, not hidden behind "could not load more". A test about what
 * the app does when the service fails says so with this first.
 */
export const allowUnrecorded = (page: Page) => void lenient.add(page);

/**
 * Answers the Worker with the Worker itself (`handle`, the same code that runs on Cloudflare):
 * its checks, its sync mailbox (in memory), and recorded OJP answers in place of OJP. A trip
 * request the real Worker would refuse (400) is reported to `problems`, so the test fails.
 */
export async function answerWorker(page: Page, problems: string[] = []) {
  // On the context: the service worker's own requests for the map pass it, not the page's routes.
  await page.context().route('https://tiles.openfreemap.org/**', (r) => r.abort());
  await page.route('https://ojp.invalid/**', async (route) => {
    const req = route.request();
    const body = req.postData() ?? undefined;
    const path = new URL(req.url()).pathname;
    // Stations abroad are asked as you type (0.66.1): one not recorded is none found, not a
    // failure (a test pausing over a name would otherwise fail by its timing).
    const eu =
      body && path.startsWith('/eu/')
        ? (recordedEu(body) ?? (path === '/eu/stops' ? '[]' : null))
        : null;
    const recorded = body ? (eu ?? recordedAnswer(body)) : null;
    if (body && !recorded && /\/(trip|departures|eu\/plan)$/.test(path) && !lenient.has(page))
      problems.push(`no recorded answer for ${body}`);
    const res = await handle(
      new Request(req.url(), {
        method: req.method(),
        headers: {
          ...req.headers(),
          ...(body ? { 'Content-Length': String(Buffer.byteLength(body)) } : {}),
        },
        body,
      }),
      {
        apiKey: 'e2e',
        upstream: 'https://ojp.example/',
        transitous: 'https://transitous.example',
        weatherUpstream: 'https://weather.example',
        allowedOrigins: [
          new URL(page.url() || 'http://localhost:4173').origin,
          'http://localhost:4173',
        ],
        // OJP: the recorded answer to this very query, else a failure the app must show.
        fetch: (async (url: string) => {
          if (String(url).startsWith('https://weather.example/')) return madeUpWeather(String(url));
          return recorded
            ? new Response(recorded, { status: 200 })
            : new Response('no recorded answer', { status: 500 });
        }) as typeof fetch,
        cache: { match: async () => undefined, put: async () => undefined },
        limit: async () => true,
        limitWrite: async () => true,
        now: () => new Date(),
        defer: () => undefined,
        sync: (id, r) =>
          syncHandle(r, {
            get: async () => boxes.get(id),
            put: async (x) => void boxes.set(id, x),
          }),
      },
    );
    if (res.status === 400)
      problems.push(
        `Worker refused ${new URL(req.url()).pathname}: ${await res.clone().text()} ${body ?? ''}`,
      );
    await route.fulfill({
      status: res.status,
      headers: Object.fromEntries(res.headers),
      body: Buffer.from(await res.arrayBuffer()),
    });
  });
}

/**
 * Answers the Worker for `page` and collects its errors: uncaught ones and console errors.
 * Failed loads are allowed only where a test means them: map tiles (unreachable on purpose),
 * live train data and answers not recorded (the app then says so itself). Every page a test
 * opens goes through this, the extra ones too (`guard(other)`, then `check()`).
 */
export async function guard(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = m.location().url ?? '';
    const failedLoad = /Failed to load resource|ERR_FAILED/.test(m.text());
    const meant =
      failedLoad &&
      (/openfreemap|ojp\.invalid\/(journey|trip|departures)/.test(url + m.text()) ||
        // Sync's own answers: a write that lost the race (409), a replaced key (410).
        (/ojp\.invalid\/sync\//.test(url) && /\b(409|410)\b/.test(m.text())) ||
        // OJP had no recorded answer: the Worker passes on the upstream failure (502).
        (/ojp\.invalid\/(trip|journey)/.test(url) && /\b502\b/.test(m.text())));
    if (!meant) errors.push(`console.error: ${m.text()} ${url}`);
  });
  await answerWorker(page, errors);
  // The service worker's "new version" prompt can come up mid-test (a fresh context's worker
  // still settling; CI, 10 Nov 2026: it covered More). No test is about it: dismissed as a
  // person would, whenever it gets in the way.
  await page.addLocatorHandler(page.locator('.banner[role="status"]'), async (banner) => {
    await banner.getByRole('button', { name: 'Dismiss' }).click();
  });
  return { errors, check: () => expect(errors, 'page errors').toEqual([]) };
}

export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const g = await guard(page);
      await use(g.errors);
      g.check();
    },
    { auto: true },
  ],
});

export { expect };

/** A day before the recorded trips (FIXTURE_DATE, Sat 7 Nov 2026): trips dated then are ahead. */
export const BEFORE = new Date('2026-11-02T08:00:00Z');

/** Opens a route link (old `#/t/` share) and makes it a trip; waits for its timetable. */
export async function planShared(page: Page, hash: string) {
  await page.goto(`./${hash}`);
  await page.getByRole('button', { name: 'Plan this trip' }).click();
  await expect(page).toHaveURL(/#\/trip\/[\w-]+$/);
  // Under way both show (0.62.0: the live information over the same screen).
  await expect(page.locator('.facts, .next').first()).toBeVisible({
    timeout: 30_000,
  });
}

/** Types into the add sheet's search and takes the first answer (Enter), or the one named. */
export async function pick(page: Page, text: string, name?: RegExp) {
  const search = page.getByPlaceholder('Station, scenic line or past trip');
  await search.fill(text);
  if (name) await page.getByRole('button', { name }).first().click();
  else await search.press('Enter');
}

/** A new trip from the list with these stations, each after the one before. */
export async function newTrip(page: Page, ...stations: string[]) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New trip' }).click();
  for (const [i, station] of stations.entries()) {
    if (i) await page.getByRole('button', { name: 'Add a station' }).click();
    await pick(page, station);
  }
}
