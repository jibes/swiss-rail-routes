// Shared Playwright setup: every test fails on an uncaught page error or console.error, and the
// OJP Worker (the build's VITE_OJP_URL, https://ojp.invalid) is answered from the recorded
// acceptance answers (tests/fixtures/ojp/*/<sha1>.xml.gz, keyed like tests/acceptance/ojp.ts).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, test as base } from '@playwright/test';

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
      await page.route('https://tiles.openfreemap.org/**', (r) => r.abort());
      await page.route('https://ojp.invalid/**', async (route) => {
        const xml = recordedAnswer(route.request().postData() ?? '');
        await (xml
          ? route.fulfill({ status: 200, contentType: 'application/xml', body: xml })
          : route.fulfill({ status: 500, body: 'no recorded answer' }));
      });
      await use(errors);
      expect(errors, 'page errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
