// One trip per day of travel (0.64.0): a trip ends where you sleep. A stay runs to the end of its
// day at most; a night at a station is the end of one trip and the start of the next. A night
// train is a ride, never split. Trips from before, with a stay into a later day, are split there.
import type { Tour, Waypoint } from './model';
import { zurichLocal } from './planner/plan';
import { dayOf, departure, isOver, withoutTimetable, type Trip } from './trip';

/** Arrivals at the trip's stopping stations (by waypoint index), from its timetable. */
function arrivals(t: Pick<Trip, 'route' | 'legs' | 'chain'>): Map<number, string> {
  const out = new Map<number, string>();
  if (!t.legs || !t.chain) return out;
  const ws = t.route.waypoints;
  let k = 1;
  t.legs.forEach((leg, i) => {
    // The leg's end is the next stopping station with its stop (legs merged or turned at a
    // loop end elsewhere: what does not match is left unknown).
    while (k < ws.length && (ws[k]!.kind === 'via' || ws[k]!.stopRef !== leg.to.stopRef)) k++;
    const c = t.chain!.connections[i];
    if (k < ws.length && c) out.set(k++, c.arr);
  });
  return out;
}

/**
 * Where a stay is kept until a later day than you arrive (a night there): the index of each
 * such station and its end (`YYYY-MM-DDTHH:MM`, Zurich). A stay given as a length is never a
 * night (a late arrival may carry it past midnight: a wait for the last train). The arrival is
 * the plan's; unplanned, the day of the stay before (a night train before it may make that
 * early, and the trip is split a station sooner than planned would: still a night there).
 */
export function nightsOf(t: Pick<Trip, 'route' | 'legs' | 'chain'>): { k: number; end: string }[] {
  // Items this version cannot read (held as they came, `listStore`) are none of its business.
  if (!Array.isArray(t.route?.waypoints)) return [];
  const arr = arrivals(t);
  const ws = t.route.waypoints;
  let day = t.route.date;
  const out: { k: number; end: string }[] = [];
  for (let k = 1; k < ws.length - 1; k++) {
    const end = ws[k]!.kind === 'via' ? undefined : ws[k]!.stayUntil;
    if (!end) continue;
    const a = arr.get(k);
    const arrDay = a ? zurichLocal(Date.parse(a)).slice(0, 10) : day;
    if (end.slice(0, 10) > arrDay) out.push({ k, end });
    day = end.slice(0, 10);
  }
  return out;
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
    const { stayUntil: _s, arriveAfter: _a, ring: _r, line: _l, templateId: _t, ...rest } = w;
    return { ...rest, kind: 'start', dwellMin: 0 };
  });

/**
 * A trip split at its nights, each to be planned again: the first keeps its id and name; each next one is `<id>-2`, `<id>-3`… (the same on every device, so synced devices
 * splitting alike make no copies), on the day and from the time its stay ended, to be planned.
 */
export function splitNights(t: Trip): Trip[] {
  const nights = nightsOf(t);
  if (!nights.length) return [t];
  const ws = t.route.waypoints;
  const cuts = [0, ...nights.map((n) => n.k), ws.length - 1];
  return cuts.slice(0, -1).map((from, i): Trip => {
    const to = cuts[i + 1]!;
    let part = ws.slice(from, to + 1);
    if (i > 0) part = starting(part);
    if (i < cuts.length - 2) part = ending(part);
    const end = i > 0 ? nights[i - 1]!.end : undefined;
    const route: Tour = {
      ...t.route,
      id: i ? `${t.route.id}-${i + 1}` : t.route.id,
      name: i ? '' : t.route.name,
      waypoints: part,
      ...(end ? { date: end.slice(0, 10), anchor: { departAt: end.slice(11, 16) } } : {}),
    };
    const base = withoutTimetable(t);
    const { previous: _p, ...rest } = base;
    return {
      ...rest,
      id: i ? `${t.id}-${i + 1}` : t.id,
      name: i ? '' : t.name,
      route,
      version: t.version + 1,
    };
  });
}

/** Every trip split at its nights (the list loaded or synced in). Unchanged: the same array. */
export function splitAllNights(trips: Trip[]): Trip[] {
  if (!trips.some((t) => nightsOf(t).length)) return trips;
  const out = trips.flatMap(splitNights);
  // A part made here and also synced in (split on another device): the one made here.
  const seen = new Set<string>();
  return out.filter((t) => !seen.has(t.id) && (seen.add(t.id), true));
}

/**
 * Where a new trip may start (0.64.0, offered first in its search): the end of the trip ahead or
 * under way that leaves last, the day after it arrives. A trip is one day; this is the next.
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
  d.setUTCDate(d.getUTCDate() + 1);
  return {
    stopRef: end.stopRef,
    name: end.name,
    date: d.toISOString().slice(0, 10),
    from: last.route.waypoints[0]!.name,
  };
}
