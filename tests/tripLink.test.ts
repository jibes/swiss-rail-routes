import { describe, expect, it } from 'vitest';
import { decodeTripLink, encodeTripLink, encodeTripLinkV1 } from '../src/core/export/tripLink';
import { encodeTrip } from '../src/core/export/tripShare';
import { journeyNumber } from '../src/core/export/tripPack';
import { plan } from '../src/core/planner/plan';
import { refreshChain, type RefreshDeps } from '../src/core/refresh';
import type { Connection, Section } from '../src/core/model';
import type { TripQuery } from '../src/core/ojp/request';
import { parseTripQuery } from '../src/core/ojp/request';
import { placeByName, stopKey } from '../src/core/stops';
import { toB64Url } from '../src/core/b64';
import { pipe } from '../src/core/export/tripShare';
import { changesOf } from '../src/core/trip';
import { isPlanned, newTrip, type PlannedTrip } from '../src/core/trip';
import { FIXTURE_DATE, ojpFor } from './acceptance/ojp';
import { acceptanceTours } from './acceptance/tours';
import { ga, index, templates } from './helpers/timetable';

const nameOf = (ref: string) => index.byRef(stopKey(ref))?.name;
const stop = (r: string) => index.byRef(r);

describe('a trip as its trains', async () => {
  const tour = acceptanceTours(FIXTURE_DATE).T3!;
  const r = await plan(tour, { ...ojpFor('T3'), templates, ga, stop });
  const trip = newTrip(
    'mine',
    { ...tour, name: 'Voralpen + Brünig' },
    r.legs!,
    r.recommended!,
    new Date(0),
  );
  const rides = (t: PlannedTrip) =>
    t.chain.connections.flatMap((c) => c.sections).filter((s) => s.mode !== 'walk');
  const allSections = trip.chain.connections.flatMap((c) => c.sections);

  const opened = async (t: PlannedTrip = trip) => {
    const back = await decodeTripLink(await encodeTripLink(t, nameOf), 'theirs', nameOf);
    expect(back && isPlanned(back)).toBe(true);
    return back as PlannedTrip;
  };
  /** OJP as these rides are: every answer holds them all, whole. */
  const deps = (over: Partial<RefreshDeps> = {}): RefreshDeps => ({
    ask: async () => trip.chain.connections,
    templates,
    ga,
    stop,
    today: '2026-11-01',
    ...over,
  });

  it('fits any messenger: far under 2000 characters, a fraction of the full link', async () => {
    const link = await encodeTripLink(trip, nameOf);
    expect(link.startsWith('#/s/')).toBe(true);
    expect(link.length).toBeLessThan(1200);
    expect(link.length).toBeLessThan((await encodeTrip(trip)).length / 3);
  });

  it('says the same number of changes as the trip screen', async () => {
    const back = await opened();
    expect(changesOf(back.chain.connections)).toBe(changesOf(trip.chain.connections));
  });

  it('a link written until 0.15.0, with time windows on its stations, still opens', async () => {
    const data = [
      1,
      'Old',
      '',
      trip.route.date,
      'd08:00',
      'GA',
      2,
      [
        ['3000', 0, 0, 0, 0, 0, 0, '09:30', '17:00'],
        ['9000', 4, 0, 0, 0, 0, 0, 0, '18:00'],
      ],
      [[480, 600, [['', 0, ['3000', 480], ['9000', 600]]]]],
    ];
    const json = new TextEncoder().encode(JSON.stringify(data));
    const hash = '#/s/' + toB64Url(await pipe(json, new CompressionStream('deflate-raw')));
    const back = await decodeTripLink(hash, 'old', nameOf);
    expect(back?.route.waypoints.map((w) => w.name)).toEqual(['Zürich HB', 'Chur']);
    expect(back?.route.waypoints.some((w) => 'earliestArr' in w || 'latestDep' in w)).toBe(false);
  });

  it('holds the trip’s trains: each ride, where you board and get off, its times', async () => {
    const back = await opened();
    expect(back.name).toBe('Voralpen + Brünig');
    expect(back.route.date).toBe(trip.route.date);
    expect(back.route.anchor).toEqual(trip.route.anchor);
    expect(back.route.ticket).toBe(trip.route.ticket);
    expect(back.route.waypoints.map((w) => [w.stopRef, w.kind, w.dwellMin, w.name])).toEqual(
      trip.route.waypoints.map((w) => [w.stopRef, w.kind, w.dwellMin, w.name]),
    );
    expect(back.legs.map((l) => [l.from.stopRef, l.to.stopRef])).toEqual(
      trip.legs.map((l) => [l.from.stopRef, l.to.stopRef]),
    );
    expect(back.chain.dep).toBe(trip.chain.dep);
    expect(back.chain.arr).toBe(trip.chain.arr);
    // Stations, not platforms: the platforms (and a number the journey id does not hold) come
    // back when it is asked again, below.
    const pick = (s: Section) => [
      s.journey,
      s.mode,
      s.line,
      s.category,
      stopKey(s.from.stopRef),
      s.from.dep,
      stopKey(s.to.stopRef),
      s.to.arr,
    ];
    expect(rides(back).map(pick)).toEqual(rides(trip).map(pick));
    expect(rides(back).every((s) => !s.from.platform && !s.to.platform)).toBe(true);
    const numbers = (t: PlannedTrip) =>
      rides(t).map((s) => (s.number === journeyNumber(s.journey) ? s.number : undefined));
    expect(rides(back).map((s) => s.number)).toEqual(numbers(trip));
    // Walks stay: they are how the rides connect.
    expect(back.chain.connections.flatMap((c) => c.sections).map((s) => s.mode)).toEqual(
      allSections.map((s) => s.mode),
    );
    expect(back.chain.connections.flatMap((c) => c.sections).map((s) => s.walkMin)).toEqual(
      allSections.map((s) => s.walkMin),
    );
  });

  it('carries a name the app does not know, and any odd id unharmed', async () => {
    const t = structuredClone(trip);
    const ride = rides(t)[0]!;
    // A platform's odd id is its station's (refresh asks by station); an id of no known form
    // stays as it was, and so does an odd journey.
    ride.from.stopRef = 'ch:1:sloid:999999_gen:ch:1:sloid:999999:0:94927_pf:2A';
    ride.from.name = 'Unknown Halt';
    ride.to.stopRef = 'de:08111:6115';
    ride.journey = '2026-11-08:other:journey:1';
    t.route.waypoints[1]!.stopRef = '8509000';
    const back = await opened(t);
    const r = rides(back)[0]!;
    expect(r.from.stopRef).toBe('ch:1:sloid:999999');
    expect(r.from.name).toBe('Unknown Halt');
    expect(r.to.stopRef).toBe('de:08111:6115');
    expect(r.journey).toBe('2026-11-08:other:journey:1');
    expect(back.route.waypoints[1]!.stopRef).toBe('8509000');
  });

  it('asked again, it is the same trip as the sender’s: stops, platforms, tracks, notices', async () => {
    const back = await opened();
    expect(rides(back).every((s) => !s.geometry && !s.intermediate.length)).toBe(true);
    const r2 = await refreshChain(back, deps());
    expect({ rides: r2.rides, found: r2.found, gone: r2.gone, failed: r2.failed }).toEqual({
      rides: rides(trip).length,
      found: rides(trip).length,
      gone: 0,
      failed: 0,
    });
    const filled = r2.chain.connections.flatMap((c) => c.sections);
    expect(filled.filter((s) => s.mode !== 'walk')).toEqual(rides(trip));
    expect(r2.chain.dep).toBe(trip.chain.dep);
    expect(r2.chain.arr).toBe(trip.chain.arr);
    expect(r2.chain.warnings.map((w) => w.key).sort()).toEqual(
      trip.chain.warnings.map((w) => w.key).sort(),
    );
  });

  it('asks only what the Worker takes: the station, not OJP’s id for a platform', async () => {
    const asked: TripQuery[] = [];
    const t = structuredClone(trip);
    rides(t)[0]!.from.stopRef = 'ch:1:sloid:7492_gen:ch:1:sloid:7492:0:94927_pf:2A';
    await refreshChain(t, deps({ ask: async (q) => (asked.push(q), []) }));
    expect(asked[0]!.origin.ref).toBe('ch:1:sloid:7492');
    for (const q of asked) expect(typeof parseTripQuery(q)).not.toBe('string');
  });

  it('a train gone is said, on its ride, and stays shown; the others come fresh', async () => {
    const lost = rides(trip)[0]!;
    const without: Connection[] = trip.chain.connections.map((c) => ({
      ...c,
      sections: c.sections.filter((s) => s.journey !== lost.journey),
    }));
    const r2 = await refreshChain(await opened(), deps({ ask: async () => without }));
    expect(r2.gone).toBe(1);
    expect(r2.found).toBe(rides(trip).length - 1);
    const w = r2.chain.warnings.find((x) => x.type === 'train-gone')!;
    expect(w.params.at).toBe(lost.from.name);
    expect(w.severity).toBe('error');
    expect(r2.chain.connections[w.legIndex]!.sections[w.sectionIndex!]!.journey).toBe(lost.journey);
  });

  it('a day gone by: a train missing says nothing about it', async () => {
    const r2 = await refreshChain(
      await opened(),
      deps({ ask: async () => [], today: '2027-01-01' }),
    );
    expect(r2.found).toBe(0);
    expect(r2.gone).toBe(rides(trip).length);
    expect(r2.chain.warnings.some((w) => w.type === 'train-gone')).toBe(false);
  });

  it('no answer changes nothing and is counted, not called gone', async () => {
    const back = await opened();
    const r2 = await refreshChain(
      back,
      deps({
        ask: async () => {
          throw new Error('offline');
        },
      }),
    );
    expect({ found: r2.found, gone: r2.gone, failed: r2.failed }).toEqual({
      found: 0,
      gone: 0,
      failed: rides(trip).length,
    });
    expect(r2.chain.connections).toEqual(back.chain.connections);
  });

  it('a train that now runs later moves the ride and its connection’s end', async () => {
    const later = (t?: string) =>
      new Date(Date.parse(t!) + 5 * 60_000).toISOString().replace('.000', '');
    const moved = structuredClone(trip.chain.connections);
    const lastC = moved.at(-1)!;
    const last = lastC.sections.filter((s) => s.mode !== 'walk').at(-1)!;
    last.to.arr = later(last.to.arr);
    const r2 = await refreshChain(trip, deps({ ask: async () => moved }));
    expect(r2.chain.arr).toBe(later(trip.chain.arr));
    expect(r2.chain.dep).toBe(trip.chain.dep);
  });

  it('a ride without a journey id is still a ride, not a walk', async () => {
    const bare: PlannedTrip = {
      ...trip,
      chain: {
        ...trip.chain,
        connections: trip.chain.connections.map((c) => ({
          ...c,
          sections: c.sections.map((s) => ({ ...s, journey: undefined })),
        })),
      },
    };
    const back = await opened(bare);
    expect(rides(back).map((s) => s.mode)).toEqual(rides(trip).map((s) => s.mode));
    expect(rides(back).every((s) => s.journey === undefined)).toBe(true);
    const walks = (t: PlannedTrip) =>
      t.chain.connections.flatMap((c) => c.sections).filter((s) => s.mode === 'walk').length;
    expect(walks(back)).toBe(walks(trip));
  });

  it('the same train to another stop is not this ride: gone, not moved', async () => {
    const mine = rides(trip)[0]!;
    const other = mine.intermediate[0] ?? mine.from;
    const partial: Connection[] = trip.chain.connections.map((c) => ({
      ...c,
      sections: c.sections.map((s) =>
        s.journey === mine.journey ? { ...s, to: { ...other, arr: s.to.arr } } : s,
      ),
    }));
    const r2 = await refreshChain(await opened(), deps({ ask: async () => partial }));
    expect(r2.gone).toBe(1);
    const kept = r2.chain.connections
      .flatMap((c) => c.sections)
      .find((s) => s.journey === mine.journey)!;
    expect(stopKey(kept.to.stopRef)).toBe(stopKey(mine.to.stopRef));
  });

  it('rejects what is not one of these links', async () => {
    const good = await encodeTripLink(trip, nameOf);
    expect(await decodeTripLink(good.slice(0, 80), 'x', nameOf)).toBeNull();
    expect(await decodeTripLink(good.slice(0, -2), 'x', nameOf)).toBeNull();
    expect(await decodeTripLink('#/s/AAAA', 'x', nameOf)).toBeNull();
    expect(await decodeTripLink('#/j/AAAA', 'x', nameOf)).toBeNull();
  });
});

describe('the compact link (0.21.0)', async () => {
  const tours = acceptanceTours(FIXTURE_DATE);
  const planned: [string, PlannedTrip][] = [];
  for (const id of ['T1', 'T2', 'T3', 'T4', 'T5', 'T6']) {
    const r = await plan(tours[id]!, {
      ...ojpFor(id),
      templates,
      ga,
      stop,
      place: placeByName(index),
    });
    if (r.recommended)
      planned.push([
        id,
        newTrip('mine', { ...tours[id]!, name: id }, r.legs!, r.recommended, new Date(0)),
      ]);
  }
  const shape = (t: PlannedTrip) => ({
    name: t.name,
    date: t.route.date,
    anchor: t.route.anchor,
    ticket: t.route.ticket,
    travelClass: t.route.travelClass,
    waypoints: t.route.waypoints.map((w) => [
      w.stopRef,
      w.name,
      w.kind,
      w.dwellMin,
      w.templateId,
      w.line,
      !!w.ring,
      w.leaveBy,
      w.arriveAfter,
    ]),
    connections: t.chain.connections.map((c) => [
      c.dep,
      c.arr,
      c.sections.map((s) => [
        s.mode,
        s.journey,
        s.walkMin,
        stopKey(s.from.stopRef),
        s.from.dep,
        stopKey(s.to.stopRef),
        s.to.arr,
        s.category,
        s.line,
        !!s.reservationRequired,
        !!s.supplement,
      ]),
    ]),
  });

  it('every recorded tour comes back as it was sent, trains, walks and times', async () => {
    expect(planned.length).toBe(6);
    for (const [, t] of planned) {
      const back = await decodeTripLink(await encodeTripLink(t, nameOf), 'theirs', nameOf);
      expect(back && isPlanned(back)).toBe(true);
      expect(shape(back as PlannedTrip)).toEqual(shape(t));
    }
  });

  it('about half the length of the link it replaces, ending in a letter messengers keep', async () => {
    for (const [id, t] of planned) {
      const now = await encodeTripLink(t, nameOf);
      const before = await encodeTripLinkV1(t, nameOf);
      // About half, at most 0.6 (T4, 7 rides as the app plans it: 347 for 591).
      expect(now.length, id).toBeLessThan(before.length * 0.6);
      expect(now.endsWith('z'), id).toBe(true);
    }
    // Fourteen rides (T1, the Albula by bus): 939 characters before.
    const t1 = planned.find(([id]) => id === 'T1')![1];
    expect((await encodeTripLink(t1, nameOf)).length).toBeLessThan(450);
  });

  it('links sent before still open, also when a messenger dropped the - or _ they ended in', async () => {
    let cut = 0;
    for (const [, t] of planned) {
      const old = await encodeTripLinkV1(t, nameOf);
      const back = await decodeTripLink(old, 'theirs', nameOf);
      expect(back && isPlanned(back)).toBe(true);
      if (/[-_]$/.test(old)) {
        cut++;
        const dropped = await decodeTripLink(old.slice(0, -1), 'theirs', nameOf);
        expect(dropped && shape(dropped as PlannedTrip)).toEqual(shape(back as PlannedTrip));
      }
    }
    // T4 and T5 end in `_`: the links that "broke in a messenger".
    expect(cut).toBeGreaterThan(0);
  });

  it('a link cut short or changed opens as damaged, never as another trip', async () => {
    const t = planned[0]![1];
    const link = await encodeTripLink(t, nameOf);
    for (const bad of [
      link.slice(0, -1),
      link.slice(0, -2),
      link.slice(0, Math.floor(link.length / 2)),
      `${link.slice(0, 20)}${link[20] === 'A' ? 'B' : 'A'}${link.slice(21)}`,
    ])
      expect(await decodeTripLink(bad, 'theirs', nameOf)).toBeNull();
  });
});
