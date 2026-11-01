// A trip: a route frozen with its date, ticket and the connections chosen for it (SPEC "Trips").
import type { Leg, Tour } from './model';
import { simplify } from './polyline';
import type { PlannedChain } from './planner/plan';

export interface TripVersion {
  /** The route as planned (waypoints, date, anchor, ticket). */
  route: Tour;
  legs: Leg[];
  chain: PlannedChain;
  savedAt: string;
}

export interface Trip extends TripVersion {
  id: string;
  /** The saved route it came from, if any (a shared trip has none). */
  routeId?: string;
  name: string;
  version: number;
  /** The version before the last replan, for undo. */
  previous?: TripVersion;
  /** Tracks already simplified (compactTrip): done once, so the trip's hash stays put. */
  compact?: true;
  schema: 1;
}

/**
 * Tracks within ~30 m are as good on the map and a fraction of the size: stored and synced
 * trips stay small (a full OJP track runs to tens of kB per trip).
 */
export const TRACK_KEEP = 0.0003;

const compactChain = (c: PlannedChain): PlannedChain => ({
  ...c,
  connections: c.connections.map((x) => ({
    ...x,
    sections: x.sections.map((s) =>
      s.geometry && s.geometry.length > 2
        ? { ...s, geometry: simplify(s.geometry, TRACK_KEEP) }
        : s,
    ),
  })),
});

/** The trip with its tracks (and its undo version's) simplified, once. */
export function compactTrip(t: Trip): Trip {
  if (t.compact) return t;
  return {
    ...t,
    chain: compactChain(t.chain),
    ...(t.previous ? { previous: { ...t.previous, chain: compactChain(t.previous.chain) } } : {}),
    compact: true,
  };
}

export type TripStatus = 'upcoming' | 'live' | 'past';

/** Live from 30 min before the first departure to 15 min after the last arrival. */
export const LIVE_BEFORE_MIN = 30;
export const LIVE_AFTER_MIN = 15;

/** `arrival`: the expected arrival with live delays, so a late last train keeps it live. */
export function tripStatus(t: Pick<Trip, 'chain'>, now: number, arrival?: number): TripStatus {
  const dep = Date.parse(t.chain.dep);
  const arr = Math.max(Date.parse(t.chain.arr), arrival ?? 0);
  if (now < dep - LIVE_BEFORE_MIN * 60_000) return 'upcoming';
  if (now > arr + LIVE_AFTER_MIN * 60_000) return 'past';
  return 'live';
}

export function newTrip(
  id: string,
  route: Tour,
  legs: Leg[],
  chain: PlannedChain,
  now: Date,
): Trip {
  return compactTrip({
    id,
    routeId: route.id,
    name: route.name,
    route: structuredClone(route),
    legs,
    chain,
    savedAt: now.toISOString(),
    version: 1,
    schema: 1,
  });
}

/** A new version of the trip; the current one is kept for undo. */
export function revise(t: Trip, next: Omit<TripVersion, 'savedAt'>, now: Date): Trip {
  const { route, legs, chain, savedAt } = t;
  return compactTrip({
    ...t,
    ...next,
    savedAt: now.toISOString(),
    version: t.version + 1,
    previous: { route, legs, chain, savedAt },
    compact: undefined,
  });
}

/** Back to the version before the last replan (only one step is kept). */
export function undo(t: Trip): Trip {
  if (!t.previous) return t;
  return { ...t, ...t.previous, version: t.version + 1, previous: undefined };
}

/** Upcoming and live trips soonest first, then past ones most recent first. */
/** The expected arrival of a trip from live data, when there is some (see expectedArrival). */
export type ArrivalOf = (t: Trip) => number | undefined;

export function sortTrips(
  trips: Trip[],
  now: number,
  arrivalOf: ArrivalOf = () => undefined,
): { current: Trip[]; past: Trip[] } {
  const dep = (t: Trip) => Date.parse(t.chain.dep);
  const past = (t: Trip) => tripStatus(t, now, arrivalOf(t)) === 'past';
  return {
    current: trips.filter((t) => !past(t)).sort((a, b) => dep(a) - dep(b)),
    past: trips.filter(past).sort((a, b) => dep(b) - dep(a)),
  };
}

/** The trip under way now, if any (the one that started last). */
export const liveTrip = (trips: Trip[], now: number, arrivalOf: ArrivalOf = () => undefined) =>
  trips
    .filter((t) => tripStatus(t, now, arrivalOf(t)) === 'live')
    .sort((a, b) => Date.parse(b.chain.dep) - Date.parse(a.chain.dep))[0];
