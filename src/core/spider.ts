// The map planner's web (pure): from a stop's departures, every place reachable without
// changing, with the earliest arrival and the train that gets there, and the lines to draw
// through their stops. A place further out gets an estimate: by the nearest place reached, a
// change and the straight distance at regional speed, said as about, never as a timetable.
import type { Connection, LatLon, Section, Tour } from './model';
import { zurichLocal } from './planner/plan';

type Mode = Section['mode'];
import type { Departures } from './ojp/departures';
import { kmBetween, stopKey } from './stops';

/** Trains leaving later than this after the time asked are not shown: a day trip's horizon. */
export const HORIZON_MIN = 180;
/** An estimate's change: getting off, across the station, the next train. */
export const CHANGE_MIN = 10;
/** An estimate's speed over the straight distance (regional trains, curves, stops). */
export const ESTIMATE_KMH = 45;

export interface Reached {
  key: string;
  name: string;
  /** Earliest arrival, ISO. */
  arr: string;
  /** The train that gets there first, and when it leaves the stop the web starts from. */
  dep: string;
  line?: string;
  category?: string;
  mode: Mode;
  destination?: string;
  pos: LatLon;
  /** How many of the trains from here call there: a place's weight on the map (its name). */
  calls: number;
}

export interface WebLine {
  /** Stop keys in order, the stop it starts from first. */
  keys: string[];
  coords: [number, number][];
  mode: Mode;
  line?: string;
}

export interface Web {
  from: string;
  reached: Reached[];
  lines: WebLine[];
}

const ms = (iso: string) => Date.parse(iso);

export function spiderWeb(
  d: Departures,
  o: { from: string; at: string; place: (key: string) => LatLon | undefined },
): Web {
  const start = stopKey(o.from);
  const until = ms(o.at) + HORIZON_MIN * 60_000;
  const where = (key: string) => o.place(key) ?? d.places.get(key);
  const best = new Map<string, Reached>();
  const trains = new Map<string, number>();
  const lines = new Map<string, WebLine>();
  for (const s of d.rides) {
    if (!s.from.dep || ms(s.from.dep) < ms(o.at) || ms(s.from.dep) > until) continue;
    const calls = [...s.intermediate, s.to];
    const keys = [start];
    for (const c of calls) {
      const key = stopKey(c.stopRef);
      const pos = where(key);
      const arr = c.arr ?? c.dep;
      if (!pos || !arr || key === start) continue;
      keys.push(key);
      trains.set(key, (trains.get(key) ?? 0) + 1);
      const was = best.get(key);
      if (!was || ms(arr) < ms(was.arr))
        best.set(key, {
          key,
          name: c.name,
          arr,
          dep: s.from.dep,
          line: s.line,
          category: s.category,
          mode: s.mode,
          destination: s.destination,
          pos,
          calls: 0,
        });
    }
    const sig = keys.join('>');
    if (keys.length > 1 && !lines.has(sig)) {
      const coords = keys.map((k) => where(k)).filter((p): p is LatLon => !!p);
      lines.set(sig, {
        keys,
        coords: coords.map((p) => [p.lon, p.lat]),
        mode: s.mode,
        line: s.line,
      });
    }
  }
  // A pattern another one holds stop for stop (the same line, shortened) is not drawn twice.
  const all = [...lines.values()];
  const kept = all.filter(
    (l) =>
      !all.some(
        (m) =>
          m !== l &&
          m.keys.length > l.keys.length &&
          // Stop for stop: a key that only begins as another's is not the same stop (audit 3).
          l.keys.every((k, i) => m.keys[i] === k),
      ),
  );
  return {
    from: start,
    reached: [...best.values()]
      .map((r) => ({ ...r, calls: trains.get(r.key) ?? 1 }))
      .sort((a, b) => ms(a.arr) - ms(b.arr)),
    lines: kept,
  };
}

/** The places named on the map from the start: the `n` most trains call at (the biggest). */
export function biggest(web: Web, n = 10): Set<string> {
  return new Set(
    [...web.reached]
      .sort((a, b) => b.calls - a.calls || ms(a.arr) - ms(b.arr))
      .slice(0, n)
      .map((r) => r.key),
  );
}

export interface Estimate {
  /** Minutes from the time the web starts at; about, by `via` and a change. */
  minutes: number;
  via?: Reached;
}

/** About how long to a place no direct train reaches: by the nearest place reached and a change. */
export function estimate(web: Web, at: string, origin: LatLon, target: LatLon): Estimate {
  const travel = (km: number) => (km / ESTIMATE_KMH) * 60;
  let out: Estimate = { minutes: Math.round(travel(kmBetween(origin, target)) + CHANGE_MIN) };
  for (const r of web.reached) {
    const m = (ms(r.arr) - ms(at)) / 60_000 + CHANGE_MIN + travel(kmBetween(r.pos, target));
    if (m < out.minutes) out = { minutes: Math.round(m), via: r };
  }
  return out;
}

/**
 * When you leave a station of the trip, local `YYYY-MM-DDTHH:MM`: the plan's train from it, else
 * its arrival there and the stay, else the time the trip leaves (a trip not planned yet).
 */
export function leaveTime(
  route: Pick<Tour, 'date' | 'anchor' | 'waypoints'>,
  connections: Connection[] | undefined,
  stopRef: string,
): string {
  const key = stopKey(stopRef);
  const sections = (connections ?? []).flatMap((c) => c.sections);
  const dep = sections.find((s) => s.mode !== 'walk' && stopKey(s.from.stopRef) === key)?.from.dep;
  if (dep) return zurichLocal(Date.parse(dep));
  const arr = sections.findLast((s) => s.mode !== 'walk' && stopKey(s.to.stopRef) === key)?.to.arr;
  const stay = route.waypoints.find((w) => stopKey(w.stopRef) === key)?.dwellMin ?? 0;
  if (arr) return zurichLocal(Date.parse(arr) + stay * 60_000);
  const hm = 'departAt' in route.anchor ? route.anchor.departAt : route.anchor.arriveBy;
  return `${route.date}T${hm}`;
}
