import { describe, expect, it } from 'vitest';
import { decodeTripLink, encodeTripLink } from '../src/core/export/tripLink';
import { encodeTrip } from '../src/core/export/tripShare';
import { plan } from '../src/core/planner/plan';
import { refreshChain, type RefreshDeps } from '../src/core/refresh';
import type { Connection, Section } from '../src/core/model';
import type { TripQuery } from '../src/core/ojp/request';
import { parseTripQuery } from '../src/core/ojp/request';
import { stopKey } from '../src/core/stops';
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
    const pick = (s: Section) => [
      s.journey,
      s.mode,
      s.line,
      s.category,
      s.number,
      s.from.stopRef,
      s.from.dep,
      s.from.platform,
      s.to.stopRef,
      s.to.arr,
      s.to.platform,
    ];
    expect(rides(back).map(pick)).toEqual(rides(trip).map(pick));
    // Walks stay: they are how the rides connect.
    expect(back.chain.connections.flatMap((c) => c.sections).map((s) => s.mode)).toEqual(
      allSections.map((s) => s.mode),
    );
    expect(back.chain.connections.flatMap((c) => c.sections).map((s) => s.walkMin)).toEqual(
      allSections.map((s) => s.walkMin),
    );
  });

  it('carries a name the app does not know, and any odd id unharmed', async () => {
    const odd = '7492_gen:ch:1:sloid:7492:0:94927_pf:2A';
    const t = structuredClone(trip);
    const ride = rides(t)[0]!;
    ride.from.stopRef = `ch:1:sloid:${odd}`;
    ride.from.name = 'Unknown Halt';
    ride.to.stopRef = '8509000';
    ride.journey = '2026-11-08:other:journey:1';
    const back = rides(await opened(t))[0]!;
    expect(back.from.stopRef).toBe(`ch:1:sloid:${odd}`);
    expect(back.from.name).toBe('Unknown Halt');
    expect(back.to.stopRef).toBe('8509000');
    expect(back.journey).toBe('2026-11-08:other:journey:1');
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
