// A stay said as one row (0.51.0): how long and until when, each filled from the other by the
// plan's arrival. The one edited last is what is kept: a length (relative, `dwellMin`) or a time
// (absolute, `stayUntil`). Times here are local Zurich `YYYY-MM-DDTHH:MM`; arrivals ISO.
import { zurichDateTime } from './ojp/request';
import { zurichLocal } from './planner/plan';
import type { Waypoint } from './model';

const MIN = 60_000;

/** Until when a stay lasts: its time, else the arrival and its length; unknown before a plan. */
export function stayEnd(
  arr: string | undefined,
  stay: number,
  until: string | undefined,
): string | undefined {
  if (until) return until;
  return arr ? zurichLocal(Date.parse(arr) + stay * MIN) : undefined;
}

/** How long a stay lasts: its length, else from the arrival to its time (unknown before). */
export function stayLength(
  arr: string | undefined,
  stay: number,
  until: string | undefined,
): number | undefined {
  if (!until) return stay;
  if (!arr) return undefined;
  return Math.max(0, Math.round((Date.parse(zurichDateTime(until)) - Date.parse(arr)) / MIN));
}

/**
 * A time typed for the stay's end, on the arrival's day (else the trip's): a stay ends the day it
 * starts (0.64.0: a night is the end of a trip, the next one starts there). None before the
 * arrival.
 */
export function untilAt(hm: string, arr: string | undefined, day: string): string | null {
  const arrived = arr ? zurichLocal(Date.parse(arr)) : undefined;
  const at = `${arrived?.slice(0, 10) ?? day}T${hm}`;
  return arrived && at < arrived ? null : at;
}

/** A stay's time moved by `min` minutes. */
export function shiftUntil(until: string, min: number): string {
  return zurichLocal(Date.parse(zurichDateTime(until)) + min * MIN);
}

const dayMs = (d: string) => Date.parse(`${d}T12:00:00Z`);

/** Days from `from` to `to` (both `YYYY-MM-DD`). */
export const daysBetween = (from: string, to: string) =>
  Math.round((dayMs(to) - dayMs(from)) / 86_400_000);

/** A stay's time moved by whole days (its clock time kept). */
export function untilByDays(until: string, days: number): string {
  if (!days) return until;
  const t = new Date(`${until.slice(0, 10)}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return `${t.toISOString().slice(0, 10)}${until.slice(10)}`;
}

/**
 * Stations moved from one day to another (a trip's date changed, a past trip's stations reused):
 * a stay until a date and time moves with them, so it lasts as long as it did.
 */
export function staysOnDay<W extends { stayUntil?: string }>(
  waypoints: W[],
  from: string,
  to: string,
): W[] {
  const days = daysBetween(from, to);
  if (!days) return waypoints;
  return waypoints.map((w) =>
    w.stayUntil ? { ...w, stayUntil: untilByDays(w.stayUntil, days) } : w,
  );
}

/** A station as older links and data may hold it: with a time to leave by, or to come after. */
export type OldWaypoint = Waypoint & { leaveBy?: string; arriveAfter?: string };

/**
 * A station read from older links or data (0.67.0): a time to leave a stay by (`HH:MM`, the place
 * closes) is the stay until then on the trip's day, `stayUntil`, the one way a stay ends at a
 * time; a time to come no earlier (`arriveAfter`) is dropped. Both went: they were a second and
 * third way to say when a stay ends, set by no screen since 0.51.0.
 */
export function asStay(w: OldWaypoint, date: string): Waypoint {
  const { leaveBy, arriveAfter: _a, ...rest } = w;
  if (!leaveBy || rest.stayUntil || rest.kind !== 'stop') return rest;
  return { ...rest, stayUntil: `${date}T${leaveBy}` };
}

/** Trips as stored, an old time to leave by read as a stay until (`asStay`); unchanged: the same. */
export function staysOfOld<T extends { route?: { date: string; waypoints: Waypoint[] } }>(
  trips: T[],
): T[] {
  const old = (w: OldWaypoint) => w.leaveBy !== undefined || w.arriveAfter !== undefined;
  if (!trips.some((t) => Array.isArray(t.route?.waypoints) && t.route!.waypoints.some(old)))
    return trips;
  return trips.map((t) =>
    t.route && Array.isArray(t.route.waypoints) && t.route.waypoints.some(old)
      ? {
          ...t,
          route: { ...t.route, waypoints: t.route.waypoints.map((w) => asStay(w, t.route!.date)) },
        }
      : t,
  );
}
