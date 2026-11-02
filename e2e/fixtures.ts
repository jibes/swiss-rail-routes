// Shared Playwright setup: every test fails on an uncaught page error or console.error, and the
// OJP Worker (the build's VITE_OJP_URL, https://ojp.invalid) is answered from the recorded
// acceptance answers (tests/fixtures/ojp/*/<sha1>.xml.gz, keyed like tests/acceptance/ojp.ts).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, test as base, type Page } from '@playwright/test';

const DIR = 'tests/fixtures/ojp';
const tours = readdirSync(DIR).filter((d) => /^T\d/.test(d));

export function recordedAnswer(body: string): string | null {
  const key = createHash('sha1').update(body).digest('hex').slice(0, 12);
  for (const t of tours) {
    const f = `${DIR}/${t}/${key}.xml.gz`;
    if (existsSync(f)) return gunzipSync(readFileSync(f)).toString('utf8');
  }
  return null;
}

/** The Worker's sync mailbox, shared by every page of a run (ids are random per key). */
const boxes = new Map<string, { v: number; data: string; revoked?: boolean }>();

/** Answers the Worker as the build expects it: recorded OJP answers and a sync mailbox. */
export async function answerWorker(page: Page) {
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort());
  await page.route('https://ojp.invalid/**', async (route) => {
    const req = route.request();
    const sync = /\/sync\/([\w-]{43})$/.exec(new URL(req.url()).pathname);
    if (sync) {
      const id = sync[1]!;
      const json = (status: number, body: unknown) =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      const cur = boxes.get(id);
      // As the Worker: a key replaced by a new one is closed for good (410).
      if (cur?.revoked) return json(410, { revoked: true });
      if (req.method() === 'GET') {
        const known = Number(new URL(req.url()).searchParams.get('v'));
        if (cur && known && known === cur.v) return json(200, { v: cur.v, same: true });
        return json(200, cur ?? { v: 0 });
      }
      if (req.method() === 'DELETE') {
        boxes.set(id, { v: (cur?.v ?? 0) + 1, data: '', revoked: true });
        return route.fulfill({ status: 204 });
      }
      const { v, data } = req.postDataJSON() as { v: number; data: string };
      if ((cur?.v ?? 0) !== v) return json(409, cur ?? { v: 0 });
      boxes.set(id, { v: v + 1, data });
      return json(200, { v: v + 1 });
    }
    const xml = recordedAnswer(req.postData() ?? '');
    await (xml
      ? route.fulfill({ status: 200, contentType: 'application/xml', body: xml })
      : route.fulfill({ status: 500, body: 'no recorded answer' }));
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
      (/openfreemap|ojp\.invalid\/(journey|trip)/.test(url + m.text()) ||
        // Sync's own answers: a write that lost the race (409), a replaced key (410).
        (/ojp\.invalid\/sync\//.test(url) && /\b(409|410)\b/.test(m.text())));
    if (!meant) errors.push(`console.error: ${m.text()} ${url}`);
  });
  await answerWorker(page);
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
  await expect(page.locator('.hero-times').or(page.locator('.trip-progress'))).toBeVisible({
    timeout: 30_000,
  });
}
