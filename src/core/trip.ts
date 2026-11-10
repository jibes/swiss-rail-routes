// A trip: a route frozen with its date, ticket and the connections chosen for it (SPEC "Trips").
import type { Connection, Leg, Tour } from './model';
import { zurichDateTime } from './ojp/request';
import { simplify } from './polyline';
import type { PlannedChain } from './planner/plan';
import { runsOn } from './planner/connection';

export interface TripVersion {
  /** The route (waypoints, date, anchor). */
  route: Tour;
  /** The legs and chain planned for this route; absent until it has been planned (0.4.0: a trip
   * is planned while you edit it, so a new one, or one just changed, has none for a moment). */
  legs?: Leg[];
  chain?: PlannedChain;
  savedAt: string;
}

/** A trip with its timetable. */
export type PlannedTrip = Trip & { legs: Leg[]; chain: PlannedChain };
export const isPlanned = (t: Trip): t is PlannedTrip => !!t.chain && !!t.legs;

export interface Trip extends TripVersion {
  id: string;
  /** The idea it was planned from (before 0.3.0 a route kept beside it; now the idea is gone). */
  routeId?: string;
  name: string;
  version: number;
  /** The version before the last replan, for undo. */
  previous?: TripVersion;
  /** Tracks already simplified (compactTrip): done once, so the trip's hash stays put. */
  compact?: true;
  /** No notifications for this trip (0.44.0, ⋯ → Notifications off): synced, on every device. */
  quiet?: true;
  schema: 1;
}

/**
 * Tracks within ~30 m are as good on the map and a fraction of the size: stored and synced
 * trips stay small (a full OJP track runs to tens of kB per trip).
 */
export const TRACK_KEEP = 0.0003;

const compactChain = (c: PlannedChain | undefined): PlannedChain | undefined =>
  c && {
    ...c,
    connections: c.connections.map((x) => ({
      ...x,
      sections: x.sections.map((s) =>
        s.geometry && s.geometry.length > 2
          ? { ...s, geometry: simplify(s.geometry, TRACK_KEEP) }
          : s,
      ),
    })),
  };

/** The trip with its tracks (and its undo version's) simplified, once. */
export function compactTrip<T extends Trip>(t: T): T {
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

const ZURICH_DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich' });
/** The calendar day in Zurich (where trip dates are), `YYYY-MM-DD`, wherever the device is. */
export const dayOf = (now: number) => ZURICH_DAY.format(now);

/** A connection's day (Zurich) when it is not the trip's own, else nothing: said beside it. */
export const otherDay = (dep: string, tripDate: string): string | undefined => {
  const d = dayOf(Date.parse(dep));
  return d === tripDate ? undefined : d;
};

/** A Zurich date and time (`YYYY-MM-DD`, `HH:MM`) as an instant. */
export const zurichTime = (date: string, time: string): number =>
  Date.parse(zurichDateTime(`${date}T${time}`));

/**
 * How often you change vehicle: within each connection, every ride after the first (a walk
 * between is no change of its own). The one count for the trip screen and a shared trip.
 */
export const changesOf = (connections: Pick<Connection, 'sections'>[]): number =>
  connections.reduce((n, c) => {
    const rides = c.sections.filter((s) => s.mode !== 'walk');
    // The same train running on (another number at a stop) is no change.
    const on = rides.filter((s, i) => i > 0 && runsOn(rides[i - 1]!, s)).length;
    return n + Math.max(0, rides.length - 1 - on);
  }, 0);

/**
 * `arrival`: the expected arrival with live delays, so a late last train keeps it live. A trip
 * not planned yet is upcoming until its day is over.
 */
export function tripStatus(
  t: Pick<Trip, 'chain'> & { route?: Pick<Tour, 'date'> },
  now: number,
  arrival?: number,
): TripStatus {
  if (!t.chain) return t.route && t.route.date < dayOf(now) ? 'past' : 'upcoming';
  const dep = Date.parse(t.chain.dep);
  const arr = Math.max(Date.parse(t.chain.arr), arrival ?? 0);
  if (now < dep - LIVE_BEFORE_MIN * 60_000) return 'upcoming';
  if (now > arr + LIVE_AFTER_MIN * 60_000) return 'past';
  return 'live';
}

/** The trip without its timetable: the route stays, and is planned again. */
export function withoutTimetable(t: Trip): Trip {
  const { chain: _c, legs: _l, compact: _p, ...rest } = t;
  return rest;
}

export function newTrip(
  id: string,
  route: Tour,
  legs: Leg[],
  chain: PlannedChain,
  now: Date,
): PlannedTrip;
export function newTrip(
  id: string,
  route: Tour,
  legs: Leg[] | undefined,
  chain: PlannedChain | undefined,
  now: Date,
): Trip;
export function newTrip(
  id: string,
  route: Tour,
  legs: Leg[] | undefined,
  chain: PlannedChain | undefined,
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
export function revise(
  t: Trip,
  next: Omit<TripVersion, 'savedAt'> & { legs: Leg[]; chain: PlannedChain },
  now: Date,
): PlannedTrip {
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
export function undo<T extends Trip>(t: T): T {
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
  const dep = (t: Trip) => departure(t);
  const past = (t: Trip) => tripStatus(t, now, arrivalOf(t)) === 'past';
  return {
    current: trips.filter((t) => !past(t)).sort((a, b) => dep(a) - dep(b)),
    past: trips.filter(past).sort((a, b) => dep(b) - dep(a)),
  };
}

/** When it leaves: the planned departure, else its day and anchor time. */
export function departure(t: Trip): number {
  if (t.chain) return Date.parse(t.chain.dep);
  const time = 'departAt' in t.route.anchor ? t.route.anchor.departAt : t.route.anchor.arriveBy;
  return zurichTime(t.route.date, time);
}

/** The trip under way now, if any (the one that started last). */
export const liveTrip = (trips: Trip[], now: number, arrivalOf: ArrivalOf = () => undefined) =>
  trips
    .filter((t) => tripStatus(t, now, arrivalOf(t)) === 'live')
    .sort((a, b) => departure(b) - departure(a))[0];
