import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { Connection } from '../src/core/model';
import { cheapest, fareQueryOf, parseFares } from '../src/core/ojp/fare';
import { fareRequestXml, parseFareQuery } from '../src/core/ojp/fareRequest';

const answer = (name: string) =>
  gunzipSync(readFileSync(`tests/fixtures/fares/${name}.xml.gz`)).toString('utf8');

describe('fares (0.31.0)', () => {
  it('reads the cheapest ticket per class (recorded: Zürich HB → Bern, 12 Nov 2026 11:32)', () => {
    const full = parseFares(answer('zuerich-bern-full'));
    const half = parseFares(answer('zuerich-bern-half'));
    expect(cheapest(full, 2)).toEqual({ name: 'Sparbillett', price: 31.8, travelClass: 2 });
    expect(cheapest(full, 1)?.price).toBe(62);
    expect(cheapest(half, 2)?.price).toBe(18.6);
    expect(cheapest(half, 1)?.price).toBe(33.4);
    expect(parseFares('<OJP/>')).toEqual([]);
  });

  it('says no card with an empty list, Half Fare with its card', () => {
    const q = { travelClass: 2, halfFare: false } as Parameters<typeof fareRequestXml>[1];
    const none = fareRequestXml('<Trip/>', q, new Date(0), 'r');
    expect(none).toContain('<EntitlementProducts></EntitlementProducts></Traveller>');
    expect(none).toContain('<FareClass>secondClass</FareClass>');
    const hta = fareRequestXml('<Trip/>', { ...q, halfFare: true }, new Date(0), 'r');
    expect(hta).toContain('<EntitlementProductRef>HTA</EntitlementProductRef>');
  });

  const call = (ref: string, name: string, t?: string) => ({
    stopRef: ref,
    name,
    ...(t ? { dep: t, arr: t } : {}),
  });
  const c: Connection = {
    legIndex: 0,
    dep: '2026-11-12T10:02:00Z',
    arr: '2026-11-12T11:30:00Z',
    transfers: 1,
    sections: [
      {
        mode: 'rail',
        from: call('ch:1:sloid:3000:1', 'Zürich HB', '2026-11-12T10:02:00Z'),
        to: call('ch:1:sloid:7000:2', 'Bern', '2026-11-12T11:00:00Z'),
        intermediate: [],
        journey: '2026-11-12:ch:1:sjyid:100001:813-001',
      },
      {
        mode: 'walk',
        walkMin: 3,
        from: call('ch:1:sloid:7000', 'Bern'),
        to: call('ch:1:sloid:7000', 'Bern'),
        intermediate: [],
      },
      {
        mode: 'rail',
        from: call('ch:1:sloid:7000:5', 'Bern', '2026-11-12T11:10:00Z'),
        to: call('ch:1:sloid:7483:1', 'Thun', '2026-11-12T11:30:00Z'),
        intermediate: [],
        journey: '2026-11-12:ch:1:sjyid:100001:2513-001',
      },
    ],
  } as Connection;

  it('asks for a leg by its ends, its change, local time and its trains, as the Worker takes it', () => {
    const q = fareQueryOf(c, true)!;
    expect(q).toEqual({
      origin: { ref: 'ch:1:sloid:3000', name: 'Zürich HB' },
      destination: { ref: 'ch:1:sloid:7483', name: 'Thun' },
      vias: [{ ref: 'ch:1:sloid:7000', name: 'Bern' }],
      time: '2026-11-12T11:02',
      journeys: ['ch:1:sjyid:100001:813-001', 'ch:1:sjyid:100001:2513-001'],
      travelClass: 2,
      halfFare: true,
    });
    expect(typeof parseFareQuery(JSON.parse(JSON.stringify(q)))).toBe('object');
  });

  it('asks nothing for a ride OJP Fare cannot know', () => {
    const abroad = structuredClone(c);
    abroad.sections[2]!.journey = 'eu:trip-1';
    expect(fareQueryOf(abroad, false)).toBeUndefined();
    const unknown = structuredClone(c);
    delete unknown.sections[0]!.journey;
    expect(fareQueryOf(unknown, false)).toBeUndefined();
  });
});
