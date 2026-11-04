// A station no connection passes (struck through on the line): which nearby stations to try in
// its place, the route with one of them, and whether a plan reaches it (SPEC §3 "Auto-fix").
// Suggested on a tap, never applied by itself; the trying is `src/io/substitute.ts`.
import type { RouteTemplate } from './data';
import { entriesOf, replaceEntry } from './line';
import type { Connection, Tour } from './model';
import { plannedRows } from './rows';
import { stopKey, type StopMode, type StopSearch } from './stops';

/** At most this many tried per tap: each is a planner run, a few timetable requests. */
export const MAX_TRIES = 3;
/** How far from the station missed a substitute may be. */
export const NEAR_KM = 10;
const TRAINS = new Set<StopMode>(['TRAIN', 'RACK_RAILWAY']);

export interface Candidate {
  stopRef: string;
  name: string;
  km: number;
  /** On a scenic line the station missed is part of (its own or one through it). */
  sameLine: boolean;
}

/**
 * Up to `MAX_TRIES` stations near entry `k`: ones trains call at, or a station of a line the missed
 * one is on, never one of the route's own; the line's first, then the rest, nearest first in each.
 */
export function candidates(
  route: Pick<Tour, 'waypoints'>,
  k: number,
  index: Pick<StopSearch, 'byRef' | 'near'>,
  templates: RouteTemplate[],
): Candidate[] {
  const entries = entriesOf(route);
  const w = entries[k]?.w;
  if (!w) return [];
  const key = stopKey(w.stopRef);
  const at = index.byRef(key);
  if (!at) return [];
  const own = new Set(route.waypoints.map((x) => stopKey(x.stopRef)));
  const lineIds = new Set(
    [entries[k]?.w.line, entries[k + 1]?.w.line].filter((x): x is string => !!x),
  );
  const onLine = new Set<string>();
  for (const t of templates) {
    const keys = t.chain.map((s) => stopKey(s.ref));
    if (lineIds.has(t.id) || keys.includes(key)) for (const x of keys) onLine.add(x);
  }
  return (
    index
      .near(at, NEAR_KM)
      .filter((s) => !own.has(stopKey(s.ref)))
      // Trains call there, or it is the line's own (a boat pier, a cable car on a summit line).
      .filter((s) => onLine.has(stopKey(s.ref)) || s.modes.some((m) => TRAINS.has(m)))
      .map((s) => ({
        stopRef: s.ref,
        name: s.name,
        km: s.km,
        sameLine: onLine.has(stopKey(s.ref)),
      }))
      .sort((a, b) => Number(b.sameLine) - Number(a.sameLine) || a.km - b.km)
      .slice(0, MAX_TRIES)
  );
}

/** The route with `c` in place of entry `k` (a line through it goes, as on any such edit). */
export const trialRoute = <T extends Pick<Tour, 'waypoints'>>(route: T, k: number, c: Candidate) =>
  replaceEntry(route, k, { stopRef: c.stopRef, name: c.name });

/** Whether these connections reach entry `k` of `route` (it is on the line, not struck). */
export function reaches(route: Pick<Tour, 'waypoints'>, k: number, connections: Connection[]) {
  return plannedRows(route, connections).some(
    (r) => r.type === 'station' && r.entry === k && !r.missed,
  );
}

/** Minutes the trial arrives after the plan (negative: earlier). */
export const minutesLater = (planArr: string, trialArr: string) =>
  Math.round((Date.parse(trialArr) - Date.parse(planArr)) / 60_000);
