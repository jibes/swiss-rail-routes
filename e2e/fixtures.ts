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

export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => {
        // Map tiles are unreachable in tests on purpose (e2e/map.spec.ts).
        if (
          m.type() === 'error' &&
          !/openfreemap|ERR_FAILED|Failed to load resource/.test(m.text())
        )
          errors.push(`console.error: ${m.text()}`);
      });
      await answerWorker(page);
      await use(errors);
      expect(errors, 'page errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
