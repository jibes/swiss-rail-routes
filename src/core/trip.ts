// A trip: a route frozen with its date, ticket and the connections chosen for it (SPEC "Trips").
import type { Leg, Tour } from './model';
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
  schema: 1;
}

export type TripStatus = 'upcoming' | 'live' | 'past';

/** Live from 30 min before the first departure to 15 min after the last arrival. */
export const LIVE_BEFORE_MIN = 30;
export const LIVE_AFTER_MIN = 15;

export function tripStatus(t: Pick<Trip, 'chain'>, now: number): TripStatus {
  const dep = Date.parse(t.chain.dep);
  const arr = Date.parse(t.chain.arr);
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
  return {
    id,
    routeId: route.id,
    name: route.name,
    route: structuredClone(route),
    legs,
    chain,
    savedAt: now.toISOString(),
    version: 1,
    schema: 1,
  };
}

/** A new version of the trip; the current one is kept for undo. */
export function revise(t: Trip, next: Omit<TripVersion, 'savedAt'>, now: Date): Trip {
  const { route, legs, chain, savedAt } = t;
  return {
    ...t,
    ...next,
    savedAt: now.toISOString(),
    version: t.version + 1,
    previous: { route, legs, chain, savedAt },
  };
}

/** Back to the version before the last replan (only one step is kept). */
export function undo(t: Trip): Trip {
  if (!t.previous) return t;
  return { ...t, ...t.previous, version: t.version + 1, previous: undefined };
}

/** Upcoming and live trips soonest first, then past ones most recent first. */
export function sortTrips(trips: Trip[], now: number): { current: Trip[]; past: Trip[] } {
  const dep = (t: Trip) => Date.parse(t.chain.dep);
  return {
    current: trips.filter((t) => tripStatus(t, now) !== 'past').sort((a, b) => dep(a) - dep(b)),
    past: trips.filter((t) => tripStatus(t, now) === 'past').sort((a, b) => dep(b) - dep(a)),
  };
}

/** The trip under way now, if any (the one that started last). */
export const liveTrip = (trips: Trip[], now: number) =>
  trips
    .filter((t) => tripStatus(t, now) === 'live')
    .sort((a, b) => Date.parse(b.chain.dep) - Date.parse(a.chain.dep))[0];
