import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePolyline, euConnections, euPos, euRef } from '../src/core/eu/plan';
import { euStations, parseEuPlanQuery } from '../src/core/eu/request';
import { index } from './helpers/timetable';

// Recorded from Transitous, 6 Nov 2026: rail only, Saturday 7 Nov from 08:00 Swiss time.
const answer = (n: string) =>
  JSON.parse(
    gunzipSync(readFileSync(new URL(`./fixtures/eu/${n}.json.gz`, import.meta.url))).toString(),
  );
/** A Swiss station by where it lies (300 m) and nothing else: the app's own ref and name. */
const local = (p: { lat: number; lon: number }) => {
  const s = index.near(p, 0.3)[0];
  return s ? { stopRef: s.ref, name: s.name } : undefined;
};

describe('Europe through Transitous', () => {
  it('Zürich → Milano: the EC direct, from Zürich HB as the app knows it, Milan abroad', () => {
    const cs = euConnections(answer('milano'), 0, local);
    expect(cs.length).toBeGreaterThan(0);
    const ec = cs[0]!.sections.find((s) => s.mode !== 'walk')!;
    expect(ec.line).toMatch(/^EC \d+/);
    expect(ec.category).toBe('EC');
    expect(ec.from.name).toBe('Zürich HB');
    expect(ec.from.stopRef).toBe('ch:1:sloid:3000');
    expect(ec.to.stopRef.startsWith('eu:')).toBe(true);
    expect(euPos(ec.to.stopRef)!.lat).toBeCloseTo(45.486, 2);
    expect(ec.journey!.startsWith('eu:')).toBe(true);
    expect(ec.intermediate.length).toBeGreaterThan(3);
    expect(ec.geometry!.length).toBeGreaterThan(10);
    expect(Date.parse(cs[0]!.dep)).toBeLessThan(Date.parse(cs[0]!.arr));
  });

  it('Innsbruck, Lyon, Munich: trains only, each connection with its changes', () => {
    for (const n of ['innsbruck', 'lyon', 'muenchen']) {
      const cs = euConnections(answer(n), 1, local);
      expect(cs.length, n).toBeGreaterThan(0);
      expect(cs.every((c) => c.legIndex === 1)).toBe(true);
      for (const c of cs)
        expect(c.transfers).toBe(c.sections.filter((s) => s.mode !== 'walk').length - 1);
    }
  });

  it('a station abroad carries where it is; a polyline decodes', () => {
    const r = euRef(45.4863, 9.2045, 'it-trenitalia_01700:station');
    expect(euPos(r)).toEqual({ lat: 45.4863, lon: 9.2045 });
    expect(euPos('ch:1:sloid:3000')).toBeUndefined();
    // Google's example, at precision 5.
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });

  it('queries: points in Europe, a few results; stations by their trains', () => {
    expect(
      typeof parseEuPlanQuery({ from: { lat: 47, lon: 8 }, to: { lat: 45, lon: 9 }, time: 'x' }),
    ).toBe('string');
    expect(
      parseEuPlanQuery({
        from: { lat: 47, lon: 8 },
        to: { lat: 45, lon: 9 },
        time: '2026-11-07T07:00:00Z',
      }),
    ).toMatchObject({ results: 3 });
    expect(euStations([{ id: 'a', name: 'A', lat: 1, lon: 2, modes: ['BUS'] }])).toEqual([]);
  });
});
