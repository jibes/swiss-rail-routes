// Europe (0.33.0): a leg with an end abroad, planned on a recorded Transitous answer (Zürich HB →
// München Hbf, 7 Nov 2026 from 08:00), as the app asks it (src/io/ojp.ts fetchEuTrips).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { euConnections, euRef, pinEnds } from '../src/core/eu/plan';
import type { Tour } from '../src/core/model';
import type { TripQuery } from '../src/core/ojp/request';
import { plan } from '../src/core/planner/plan';
import { stopKey } from '../src/core/stops';
import { addWaypoint, newTour } from './helpers/edit';
import { DATE, deps, index, ref } from './helpers/timetable';

const answer = JSON.parse(
  gunzipSync(readFileSync('tests/fixtures/eu/muenchen.json.gz')).toString('utf8'),
) as unknown;
// München Hbf as Transitous' station search gives it: another feed's id, 200 m from the plan's.
const MUENCHEN = euRef(48.13988, 11.557491, 'at-Railway-Current-Reference-Data-2026_de:09162:100');
const where = (r: string) => {
  const s = index.byRef(r);
  return s && { lat: s.lat, lon: s.lon };
};
const local = (p: { id?: string }) => {
  const n = /ch:1:sloid:(\d+)/.exec(p.id ?? '')?.[1];
  const s = n ? index.byRef(`ch:1:sloid:${Number(n)}`) : undefined;
  return s && { stopRef: s.ref, name: s.name };
};
const abroad = async (q: TripQuery) => pinEnds(euConnections(answer, 0, local), q, where);

describe('a leg abroad (Transitous)', () => {
  const tour: Tour = {
    ...addWaypoint(newTour('t', DATE, { stopRef: ref('Zürich HB'), name: 'Zürich HB' }), {
      stopRef: MUENCHEN,
      name: 'München Hbf',
    }),
    anchor: { departAt: '08:00' },
  };

  it('a station abroad lies where its ref says', () => {
    expect(index.byRef(MUENCHEN)).toMatchObject({ lat: 48.13988, lon: 11.55749 });
  });

  it('plans to it: the leg ends at the station asked for, starts at the app’s own Zürich HB', async () => {
    const d = deps([]);
    const r = await plan(tour, { ...d.deps, fetchTrips: abroad });
    const c = r.recommended!.connections[0]!;
    const rides = c.sections.filter((s) => s.mode !== 'walk');
    expect(stopKey(rides[0]!.from.stopRef)).toBe(stopKey(ref('Zürich HB')));
    expect(rides.at(-1)!.to).toMatchObject({ stopRef: MUENCHEN, name: 'München Hbf' });
    expect(rides.every((s) => s.journey?.startsWith('eu:'))).toBe(true);
    expect(r.recommended!.warnings.map((w) => w.type)).toEqual(
      expect.not.arrayContaining(['line-missed', 'window-missed']),
    );
    // The GA ends at the border: said for the stretch abroad, from the last Swiss station.
    const ga = r.recommended!.warnings.find((w) => w.type === 'not-ga')!;
    expect(ga.params).toEqual({ from: 'St. Margrethen SG', to: 'München Hbf' });
  });
});
