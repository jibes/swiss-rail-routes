// Notifications for a saved trip, from its timetable (SPEC §3a; owner's choice 2026-11-01):
// 10 min before each departure, 5 min before each exit, 10 min before passing a highlight
// (with the sunset time when it is near). Pure: the app translates and schedules them.
import { linesOf } from './line';
import { highlightName, type RouteTemplate } from './data';
import type { LatLon } from './model';
import { liveRides, type LiveRide } from './live';
import { runsOn } from './planner/connection';
import { directionOn, flipSide } from './seat';
import { dayAt, sunset } from './sun';
import type { PlannedTrip as Trip } from './trip';

export const BEFORE_DEPARTURE_MIN = 10;
export const BEFORE_EXIT_MIN = 5;
export const BEFORE_HIGHLIGHT_MIN = 10;
/** A highlight within this long of sunset mentions it. */
const SUNSET_NEAR_MIN = 60;
const HIGHLIGHT_KM = 15;

export type NoticeKind = 'depart' | 'exit' | 'highlight';

export interface Notice {
  /** Stable per trip and event, so rescheduling replaces rather than duplicates. */
  id: number;
  kind: NoticeKind;
  at: number;
  params: Record<string, string>;
  tripId: string;
}

const km = (a: LatLon, b: LatLon) => {
  const r = Math.PI / 180;
  const x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  return Math.hypot(x, (b.lat - a.lat) * r) * 6371;
};

/** 31-bit hash of the trip id; notification ids are that plus the event number. */
function base(tripId: string): number {
  let h = 0;
  for (const c of tripId) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
  return (Math.abs(h) % 1_000_000) * 1000;
}

/**
 * Every notice its own id (review, 0.65.1: two trips whose ids hash alike replaced each other's).
 * All are cancelled before any is scheduled, so an id need only be unique, not stable.
 */
export function uniqueIds<N extends { id: number }>(notices: N[]): N[] {
  const used = new Set<number>();
  return notices.map((n) => {
    let id = n.id;
    while (used.has(id)) id++;
    used.add(id);
    return id === n.id ? n : { ...n, id };
  });
}

const hhmm = (t: number) =>
  new Intl.DateTimeFormat('de-CH', {
    timeZone: 'Europe/Zurich',
    hour: '2-digit',
    minute: '2-digit',
  }).format(t);

export function noticesFor(
  trip: Trip,
  now: number,
  templates: RouteTemplate[],
  stop: (ref: string) => LatLon | undefined,
): Notice[] {
  // Turned quiet (⋯ → Notifications off, 0.44.0): none, on every device.
  if (trip.quiet) return [];
  const out: Notice[] = [];
  const b = base(trip.id);
  let n = 0;
  const push = (kind: NoticeKind, at: number, params: Record<string, string>) => {
    n++;
    if (at > now) out.push({ id: b + n, kind, at, params, tripId: trip.id });
  };
  const rides = liveRides(trip.chain.connections, new Map());
  // The same train on both sides of a stop (a replan from on board): you stay seated, so
  // neither its exit nor the next departure is a notice.
  const through = (a?: LiveRide, b?: LiveRide) => !!a && !!b && runsOn(a.s, b.s);
  rides.forEach((r, i) => {
    const board = r.stops[0]!;
    const exit = r.stops.at(-1)!;
    const line = r.s.line ?? [r.s.category, r.s.number].filter(Boolean).join(' ');
    if (board.dep && !through(rides[i - 1], r))
      push('depart', board.dep - BEFORE_DEPARTURE_MIN * 60_000, {
        line,
        to: r.s.to.name,
        time: hhmm(board.dep),
        platform: board.platform ?? '',
        from: board.name,
      });
    if (exit.arr && !through(r, rides[i + 1]))
      push('exit', exit.arr - BEFORE_EXIT_MIN * 60_000, { stop: exit.name, time: hhmm(exit.arr) });
  });

  const ids = linesOf(trip.route.waypoints);
  for (const t of templates.filter((x) => ids.has(x.id)))
    for (const h of t.highlights) {
      // The call nearest the highlight, as for the after-sunset warning.
      let best: { d: number; at: number; ride: (typeof rides)[number] } | undefined;
      for (const r of rides)
        for (const s of r.stops) {
          const p = stop(s.key);
          const at = s.dep ?? s.arr;
          if (!p || at === undefined) continue;
          const d = km(p, h);
          if (d <= HIGHLIGHT_KM && (!best || d < best.d)) best = { d, at, ride: r };
        }
      if (!best) continue;
      const set = sunset(dayAt(best.at), h);
      const nearSunset = set && Math.abs(best.at - set.getTime()) <= SUNSET_NEAR_MIN * 60_000;
      push('highlight', best.at - BEFORE_HIGHLIGHT_MIN * 60_000, {
        name: highlightName(h),
        highlight: h.id,
        // The side is given in the line's order: the other way, the other side.
        side: h.side
          ? directionOn(best.ride.s, t)?.forward === false
            ? flipSide(h.side)
            : h.side
          : '',
        sunset: nearSunset && set ? hhmm(set.getTime()) : '',
      });
    }
  return out.sort((a, b) => a.at - b.at);
}
