// A planned trip's trains asked again: stops, platforms, tracks and notices come fresh, the
// trains stay the ones chosen. Shared links (which hold only the trains) and pull-down reload
// are both this.
import type { GaData, RouteTemplate } from './data';
import type { Connection, LatLon, Section } from './model';
import { rides } from './planner/connection';
import { legRules, mergeRepeats, splitLoops, zurichLocal, type PlannedChain } from './planner/plan';
import type { TripQuery } from './ojp/request';
import { stopKey } from './stops';
import type { PlannedTrip, Trip } from './trip';
import { warningsFor, type Warning } from './warnings';

export interface RefreshDeps {
  ask: (q: TripQuery) => Promise<Connection[]>;
  templates: RouteTemplate[];
  ga: GaData;
  stop: (ref: string) => LatLon | undefined;
  place?: (name: string) => LatLon | undefined;
  /** Today, `YYYY-MM-DD`: a train missing from a day gone by says nothing about it. */
  today: string;
}

export interface Refreshed {
  chain: PlannedChain;
  /** Rides asked, answered with their own train, missing from the answer, or not answered. */
  rides: number;
  found: number;
  gone: number;
  failed: number;
}

/** Rides asked at once: a long trip stays quick, within the Worker's limit per client. */
const AT_ONCE = 3;
const shift = (t: string, by: number) =>
  by ? new Date(Date.parse(t) + by).toISOString().replace('.000', '') : t;

/** Warnings for what the chain holds now (the planner's own, as they depend on the trip). */
export function chainWarnings(
  trip: Pick<Trip, 'route'>,
  connections: Connection[],
  deps: Pick<RefreshDeps, 'templates' | 'ga' | 'stop' | 'place'>,
): Warning[] {
  const rules = legRules(splitLoops(mergeRepeats(trip.route)), deps);
  return connections.flatMap((c, i) =>
    warningsFor(c, {
      legIndex: i,
      date: trip.route.date,
      ticket: trip.route.ticket,
      templates: rules[i]?.templates ?? [],
      ga: deps.ga,
      stop: deps.stop,
      place: deps.place,
    }),
  );
}

export async function refreshChain(trip: PlannedTrip, deps: RefreshDeps): Promise<Refreshed> {
  const asked = trip.chain.connections.flatMap((c, ci) =>
    c.sections.flatMap((s, si) => (s.mode !== 'walk' && s.journey ? [{ s, ci, si }] : [])),
  );
  const fresh = new Map<string, Section>();
  const missing: typeof asked = [];
  let failed = 0;
  const one = async (x: (typeof asked)[number]) => {
    const { from, to, journey } = x.s;
    if (!from.dep) return void failed++;
    const q: TripQuery = {
      // The station, not its platform: a platform may have changed, and OJP's own ids for some
      // platforms are not ids it takes back.
      origin: { ref: stopKey(from.stopRef), name: from.name },
      destination: { ref: stopKey(to.stopRef), name: to.name },
      vias: [],
      notVias: [],
      time: zurichLocal(Date.parse(from.dep)),
      arriveBy: false,
      results: 6,
    };
    let answer: Connection[];
    try {
      answer = await deps.ask(q);
    } catch {
      return void failed++;
    }
    // The same train, boarded and left where it was: an answer may also hold it to another
    // stop (ride it part of the way, then change), which is not this ride.
    const same = answer
      .flatMap((c) => c.sections)
      .find(
        (a) =>
          a.journey === journey &&
          stopKey(a.from.stopRef) === stopKey(from.stopRef) &&
          stopKey(a.to.stopRef) === stopKey(to.stopRef),
      );
    if (same) fresh.set(`${x.ci}:${x.si}`, same);
    else missing.push(x);
  };
  for (let i = 0; i < asked.length; i += AT_ONCE)
    await Promise.all(asked.slice(i, i + AT_ONCE).map(one));

  const connections = trip.chain.connections.map((c, ci): Connection => {
    const sections = c.sections.map((s, si) => fresh.get(`${ci}:${si}`) ?? s);
    // Its ends move with the first and last ride; a walk before or after them stays as long.
    const [first, last] = [rides(c)[0]?.[0], rides(c).at(-1)?.[0]];
    const next = { sections } as Connection;
    const [nFirst, nLast] = [rides(next)[0]?.[0], rides(next).at(-1)?.[0]];
    const moved = (a?: string, b?: string) => (a && b ? Date.parse(b) - Date.parse(a) : 0);
    const dep = shift(c.dep, moved(first?.from.dep, nFirst?.from.dep));
    const arr = shift(c.arr, moved(last?.to.arr, nLast?.to.arr));
    // A delay the fresh answer knows: expected times beside the timetable's, as when planned.
    const depEst = nFirst?.from.depEst
      ? shift(dep, moved(nFirst.from.dep, nFirst.from.depEst))
      : undefined;
    const arrEst = nLast?.to.arrEst ? shift(arr, moved(nLast.to.arr, nLast.to.arrEst)) : undefined;
    const { depEst: _d, arrEst: _a, ...rest } = c;
    return {
      ...rest,
      sections,
      dep,
      arr,
      ...(depEst ? { depEst } : {}),
      ...(arrEst ? { arrEst } : {}),
    };
  });
  const warnings = chainWarnings(trip, connections, deps);
  if (trip.route.date >= deps.today)
    for (const { s, ci, si } of missing)
      warnings.push({
        type: 'train-gone',
        severity: 'error',
        legIndex: ci,
        sectionIndex: si,
        key: 'wTrainGone',
        params: { line: s.line ?? s.category ?? '', at: s.from.name },
      });
  return {
    chain: {
      ...trip.chain,
      connections,
      warnings,
      dep: connections[0]!.dep,
      arr: connections.at(-1)!.arr,
    },
    rides: asked.length,
    found: fresh.size,
    gone: missing.length,
    failed,
  };
}
