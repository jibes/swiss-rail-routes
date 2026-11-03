// The recorded answers: every entry of a tour's index.json has its file and every file its
// entry, so a stale or half-recorded fixture is seen (`record:ojp:missing` only adds; a file
// nothing reads any more is found with FIXTURE_LOG=<file> on an e2e run, e2e/fixtures.ts).
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = 'tests/fixtures/ojp';

describe('recorded OJP answers', () => {
  for (const tour of readdirSync(DIR).filter((d) => /^T\d/.test(d))) {
    it(`${tour}: index and files agree`, () => {
      const files = readdirSync(`${DIR}/${tour}`)
        .filter((f) => f.endsWith('.xml.gz'))
        .map((f) => f.replace('.xml.gz', ''))
        .sort();
      const index = JSON.parse(readFileSync(`${DIR}/${tour}/index.json`, 'utf8')) as Record<
        string,
        { from: string; to: string; time: string }
      >;
      expect(Object.keys(index).sort()).toEqual(files);
      for (const e of Object.values(index))
        expect(e.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    });
  }
});
