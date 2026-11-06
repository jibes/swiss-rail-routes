import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseDepartures } from '../src/core/ojp/departures';
import { OjpError } from '../src/core/ojp/parse';
import { spiderWeb } from '../src/core/spider';
import { stopKey } from '../src/core/stops';
import { index } from './helpers/timetable';

// Recorded through the Worker, 6 Nov 2026: Interlaken Ost from 09:00 on 7 Nov, 40 results.
const xml = gunzipSync(
  readFileSync(new URL('./fixtures/ojp/departures/interlaken-ost.xml.gz', import.meta.url)),
).toString('utf8');

describe('a stop’s departures (OJP StopEventRequest)', () => {
  const d = parseDepartures(xml);

  it('each train as a ride from the stop to its last call, every stop between', () => {
    expect(d.rides).toHaveLength(40);
    const lix = d.rides[0]!;
    expect([lix.line, lix.category, lix.destination]).toEqual(['LIX', 'PE', 'Luzern']);
    expect(lix.journey).toMatch(/^2026-11-07:ch:1:sjyid:100064:/);
    expect(stopKey(lix.from.stopRef)).toBe('ch:1:sloid:7492');
    expect(lix.from.dep).toBe('2026-11-07T08:04:00Z');
    expect(lix.intermediate.map((c) => c.name).slice(0, 3)).toEqual([
      'Brienz',
      'Meiringen',
      'Brünig-Hasliberg',
    ]);
    expect(lix.to.name).toBe('Luzern');
  });

  it('where its stops lie, from the answer itself', () => {
    expect(d.places.get('ch:1:sloid:8305')).toBeDefined();
  });

  it('the web: the four lines from Interlaken Ost, the places they reach', () => {
    const web = spiderWeb(d, {
      from: 'ch:1:sloid:7492',
      at: '2026-11-07T08:00:00Z',
      place: (k) => index.byRef(k),
    });
    const names = web.reached.map((r) => r.name);
    for (const n of ['Lauterbrunnen', 'Grindelwald', 'Meiringen', 'Luzern'])
      expect(names).toContain(n);
    expect(web.lines.length).toBeGreaterThanOrEqual(4);
    // Earliest first: Matten, the BOB's first stop.
    expect(names[0]).toBe('Matten b. Interlaken');
  });

  it('an error is one; no departures is an answer', () => {
    expect(() => parseDepartures('<x/>')).toThrow(OjpError);
  });
});
