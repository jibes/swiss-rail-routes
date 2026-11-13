// One trip per day of travel (0.64.0): a trip ends where you sleep. A stay runs to the end of its
// day at most; a night at a station is the end of one trip and the start of the next. A night
// train is a ride, never split. A trip from before with a stay into a later day is split there
// once, as it is loaded (0.64.3): only planned and not yet begun, each part with its own share
// of the timetable, so nothing is lost or planned again.
import type { Leg, Tour, Waypoint } from './model';
import { zurichLocal } from './planner/plan';
import { dayOf, departure, isOver, type Trip } from './trip';

/**
 * The waypoint index each leg of the timetable ends at, or nothing when they do not match one to
 * one (legs merged, a loop turned elsewhere): then the trip is left as it is.
 */
function legEnds(t: Pick<Trip, 'route' | 'legs' | 'chain'>): number[] | undefined {
  if (!t.legs || !t.chain || t.legs.length !== t.chain.connections.length) return undefined;
  const ws = t.route.waypoints;
  const ends: number[] = [];
  let k = 1;
  for (const leg of t.legs) {
    while (k < ws.length && (ws[k]!.kind === 'via' || ws[k]!.stopRef !== leg.to.stopRef)) k++;
    if (k >= ws.length) return undefined;
    ends.push(k++);
  }
  return ends.at(-1) === ws.length - 1 ? ends : undefined;
}

/**
 * Where a stay is kept until a later day than the plan arrives there (a night): the index of
 * each such station and its end (`YYYY-MM-DDTHH:MM`, Zurich). Only on a planned trip: unplanned,
 * the arrival's day is not known (after a night train it is the next day). A stay given as a
 * length is never a night (a late arrival may carry it past midnight: a wait for the last train).
 */
export function nightsOf(t: Pick<Trip, 'route' | 'legs' | 'chain'>): { k: number; end: string }[] {
  // Items this version cannot read (held as they came, `listStore`) are none of its business.
  if (!Array.isArray(t.route?.waypoints)) return [];
  const ends = legEnds(t);
  if (!ends) return [];
  const ws = t.route.waypoints;
  return ends.flatMap((k, i) => {
    const end = k < ws.length - 1 ? ws[k]!.stayUntil : undefined;
    const arrDay = zurichLocal(Date.parse(t.chain!.connections[i]!.arr)).slice(0, 10);
    return end && end.slice(0, 10) > arrDay ? [{ k, end }] : [];
  });
}

/** The trip's stations up to `k`, ending there. */
const ending = (ws: Waypoint[]): Waypoint[] =>
  ws.map((w, i) => {
    if (i < ws.length - 1) return w;
    const { stayUntil: _s, leaveBy: _l, ring: _r, ...rest } = w;
    return { ...rest, kind: 'end', dwellMin: 0 };
  });

/** The trip's stations from `k`, starting there (the line leading to it is the trip before's). */
const starting = (ws: Waypoint[]): Waypoint[] =>
  ws.map((w, i) => {
    if (i > 0) return w;
    const {
      stayUntil: _s,
      arriveAfter: _a,
      leaveBy: _b,
      ring: _r,
      line: _l,
      templateId: _t,
      ...rest
    } = w;
    return { ...rest, kind: 'start', dwellMin: 0 };
  });

const hm = (iso: string) => zurichLocal(Date.parse(iso)).slice(11, 16);

/**
 * A trip split at its nights: the first keeps its id and name, each next one is `<id>-2`, `<id>-3`…
 * (the same on every device), on the day its stay ended. Each part keeps its own legs and
 * connections, warnings with them; it leaves at its first train, the last one keeps an arrive-by.
 * Not split: one unplanned, begun or over (`now`), or whose timetable does not match its stations.
 */
export function splitNights(t: Trip, now: number): Trip[] {
  if (!t.chain || Date.parse(t.chain.dep) <= now) return [t];
  const nights = nightsOf(t);
  const ends = legEnds(t);
  if (!nights.length || !ends) return [t];
  const ws = t.route.waypoints;
  const cuts = [0, ...nights.map((n) => n.k), ws.length - 1];
  const last = cuts.length - 2;
  return cuts.slice(0, -1).map((from, i): Trip => {
    const to = cuts[i + 1]!;
    let part = ws.slice(from, to + 1);
    if (i > 0) part = starting(part);
    if (i < last) part = ending(part);
    // The legs ending within this part, renumbered from 0; their ends are the part's stations.
    const first = ends.findIndex((k) => k > from);
    const count = ends.filter((k) => k > from && k <= to).length;
    const at = (w: Waypoint) => part.find((x) => x.stopRef === w.stopRef) ?? w;
    const legs: Leg[] = t.legs!.slice(first, first + count).map((l, j) => ({
      ...l,
      index: j,
      from: j === 0 ? part[0]! : at(l.from),
      to: j === count - 1 ? part.at(-1)! : at(l.to),
    }));
    const connections = t
      .chain!.connections.slice(first, first + count)
      .map((c, j) => ({ ...c, legIndex: j }));
    const warnings = t
      .chain!.warnings.filter((w) => w.legIndex >= first && w.legIndex < first + count)
      .map((w) => ({ ...w, legIndex: w.legIndex - first }));
    const dep = connections[0]!.dep;
    const arriveBy = i === last && 'arriveBy' in t.route.anchor ? t.route.anchor : undefined;
    const route: Tour = {
      ...t.route,
      id: i ? `${t.route.id}-${i + 1}` : t.route.id,
      name: i ? '' : t.route.name,
      waypoints: part,
      date: i ? nights[i - 1]!.end.slice(0, 10) : t.route.date,
      anchor: arriveBy ?? { departAt: hm(dep) },
    };
    const { previous: _p, ...rest } = t;
    return {
      ...rest,
      id: i ? `${t.id}-${i + 1}` : t.id,
      name: i ? '' : t.name,
      route,
      legs,
      chain: { ...t.chain!, connections, warnings, dep, arr: connections.at(-1)!.arr },
      version: t.version + 1,
    };
  });
}

/**
 * Every trip split at its nights, once as the list is loaded. A part whose id is already there
 * (split on another device, synced in) is kept as it is: never a copy, never one edited replaced.
 * Unchanged: the same array.
 */
export function splitAllNights(trips: Trip[], now: number): Trip[] {
  const ids = new Set(trips.map((t) => t.id));
  let changed = false;
  const out = trips.flatMap((t) => {
    const parts = splitNights(t, now);
    if (parts.length === 1) return parts;
    // Split elsewhere already: this one is the older copy; its parts there are the trip.
    if (parts.slice(1).some((p) => ids.has(p.id))) return [t];
    changed = true;
    return parts;
  });
  return changed ? out : trips;
}

/**
 * Where a new trip may start (0.64.0, offered first in its search): the end of the trip ahead or
 * under way that leaves last, the day after it arrives, or the day it arrives by a night train.
 */
export function onwardFrom(
  trips: Trip[],
  now: number,
  self: string,
): { stopRef: string; name: string; date: string; from: string } | undefined {
  const last = trips
    .filter((t) => t.id !== self && t.route.waypoints.length >= 2 && !isOver(t, now))
    .sort((a, b) => departure(b) - departure(a))[0];
  const end = last?.route.waypoints.at(-1);
  if (!last || !end) return undefined;
  const arrived = last.chain ? dayOf(Date.parse(last.chain.arr)) : last.route.date;
  const d = new Date(`${arrived}T12:00:00Z`);
  // Arrived by a night train: that day is still ahead (0.64.3); else the day after.
  if (arrived <= last.route.date) d.setUTCDate(d.getUTCDate() + 1);
  return {
    stopRef: end.stopRef,
    name: end.name,
    date: d.toISOString().slice(0, 10),
    from: last.route.waypoints[0]!.name,
  };
}
