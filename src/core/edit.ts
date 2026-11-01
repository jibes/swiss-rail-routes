// Pure edits for the tour builder. Each returns a new tour and keeps start/end kinds consistent.
import type { Tour, Waypoint, WaypointKind } from './model';

export const DWELL_PRESETS = [0, 30, 60] as const;

/** First waypoint is `start`, last is `end`; inner ones keep their kind but never start/end. */
function normalise(waypoints: Waypoint[]): Waypoint[] {
  return waypoints.map((w, i, all) => {
    const kind: WaypointKind =
      i === 0
        ? 'start'
        : i === all.length - 1 && all.length > 1
          ? 'end'
          : w.kind === 'start' || w.kind === 'end'
            ? 'via'
            : w.kind;
    const dwellMin = kind === 'stop' || kind === 'turnaround' ? w.dwellMin : 0;
    return kind === w.kind && dwellMin === w.dwellMin ? w : { ...w, kind, dwellMin };
  });
}

const withWaypoints = (tour: Tour, waypoints: Waypoint[]): Tour => ({
  ...tour,
  waypoints: normalise(waypoints),
});

export function newTour(
  id: string,
  date: string,
  start?: Pick<Waypoint, 'stopRef' | 'name'>,
): Tour {
  return {
    id,
    name: '',
    date,
    anchor: { departAt: '08:00' },
    ticket: 'GA',
    travelClass: 2,
    waypoints: start ? [{ ...start, kind: 'start', dwellMin: 0 }] : [],
    schema: 1,
  };
}

/** Inserts a stop before the end of a round trip, otherwise appends it. New inner stops ride through. */
export function addWaypoint(
  tour: Tour,
  stop: Pick<Waypoint, 'stopRef' | 'name'>,
  at?: number,
): Tour {
  const list = [...tour.waypoints];
  const index = at ?? (isClosed(tour) ? list.length - 1 : list.length);
  list.splice(index, 0, { ...stop, kind: 'via', dwellMin: 0 });
  return withWaypoints(tour, list);
}

export function removeWaypoint(tour: Tour, index: number): Tour {
  return withWaypoints(
    tour,
    tour.waypoints.filter((_, i) => i !== index),
  );
}

export function moveWaypoint(tour: Tour, from: number, to: number): Tour {
  const list = [...tour.waypoints];
  const [item] = list.splice(from, 1);
  if (!item) return tour;
  list.splice(Math.max(0, Math.min(to, list.length)), 0, item);
  return withWaypoints(tour, list);
}

/** Switches an inner waypoint between riding through and getting off (default dwell 30 min). */
export function setStop(tour: Tour, index: number, stop: boolean, dwellMin = 30): Tour {
  return withWaypoints(
    tour,
    tour.waypoints.map((w, i) =>
      i === index ? { ...w, kind: stop ? 'stop' : 'via', dwellMin: stop ? dwellMin : 0 } : w,
    ),
  );
}

export function setDwell(tour: Tour, index: number, dwellMin: number): Tour {
  return withWaypoints(
    tour,
    tour.waypoints.map((w, i) => (i === index ? { ...w, dwellMin: Math.max(0, dwellMin) } : w)),
  );
}

const isClosed = (tour: Tour) =>
  tour.waypoints.length > 1 && tour.waypoints[0]!.stopRef === tour.waypoints.at(-1)!.stopRef;

/** Round-trip switch: on appends the start as end; off removes that copy. */
export function setRoundTrip(tour: Tour, on: boolean): Tour {
  const first = tour.waypoints[0];
  if (!first || on === isClosed(tour)) return tour;
  return on
    ? withWaypoints(tour, [...tour.waypoints, { ...first }])
    : withWaypoints(tour, tour.waypoints.slice(0, -1));
}

/**
 * Inserts a route template: its first stop (unless the tour is already there), its must-pass
 * stops and its last stop, all tagged with the template so the planner applies its rules.
 * `reversed` runs it end to start. Inserted before the end of a round trip, else appended.
 */
export function insertTemplate(
  tour: Tour,
  template: { id: string; chain: { ref: string; name: string }[]; mustPass: string[] },
  reversed = false,
): Tour {
  const chain = reversed ? [...template.chain].reverse() : template.chain;
  const must = new Set(template.mustPass);
  const picked = chain.filter((s, i) => i === 0 || i === chain.length - 1 || must.has(s.ref));
  const list = [...tour.waypoints];
  const at = isClosed(tour) ? list.length - 1 : list.length;
  const before = list[at - 1];
  const add = picked
    .filter((s, i) => !(i === 0 && before?.stopRef === s.ref))
    .map((s): Waypoint => ({
      stopRef: s.ref,
      name: s.name,
      kind: 'via',
      dwellMin: 0,
      templateId: template.id,
    }));
  if (before && before.stopRef === picked[0]?.ref)
    list[at - 1] = { ...before, templateId: template.id };
  list.splice(at, 0, ...add);
  return withWaypoints(tour, list);
}
