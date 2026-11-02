// Tour builders the tests use to write tours by hand (T1–T6, planner cases). The app edits
// entries (src/core/line.ts); these were the 0.3 builder's edits, kept for the tests only.
import { insertTemplate, newTour, normalise } from '../../src/core/edit';
import type { Tour, Waypoint } from '../../src/core/model';

export { insertTemplate, newTour, normalise };

const withWaypoints = (tour: Tour, waypoints: Waypoint[]): Tour => ({
  ...tour,
  waypoints: normalise(waypoints),
});

const isClosed = (tour: Tour) =>
  tour.waypoints.length > 1 && tour.waypoints[0]!.stopRef === tour.waypoints.at(-1)!.stopRef;

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

/**
 * Removes a station. In a round trip its start and return are one station: removing either
 * removes both, and the trip closes again on the new first station (when two remain).
 */
export function removeWaypoint(tour: Tour, index: number): Tour {
  const wps = tour.waypoints;
  const last = wps.length - 1;
  if (isClosed(tour) && (index === 0 || index === last)) {
    const inner = wps.slice(1, -1);
    return withWaypoints(tour, inner.length >= 2 ? [...inner, { ...inner[0]! }] : inner);
  }
  return withWaypoints(
    tour,
    wps.filter((_, i) => i !== index),
  );
}

/** Moves a station. A round trip's start and return stay where they are (they hold the loop). */
export function moveWaypoint(tour: Tour, from: number, to: number): Tour {
  const last = tour.waypoints.length - 1;
  if (isClosed(tour) && (from === 0 || from === last || to <= 0 || to >= last)) return tour;
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

/** Round-trip switch: on appends the start as end; off removes that copy. */
export function setRoundTrip(tour: Tour, on: boolean): Tour {
  const first = tour.waypoints[0];
  if (!first || on === isClosed(tour)) return tour;
  return on
    ? withWaypoints(tour, [...tour.waypoints, { ...first }])
    : withWaypoints(tour, tour.waypoints.slice(0, -1));
}

/** Swaps the station at `index` for another, keeping whether you get off there and how long. */
export function replaceWaypoint(
  tour: Tour,
  index: number,
  stop: Pick<Waypoint, 'stopRef' | 'name'>,
): Tour {
  const w = tour.waypoints[index];
  if (!w) return tour;
  const closed = isClosed(tour);
  const list = tour.waypoints.map((x, i) =>
    i === index ? { ...x, ...stop, templateId: undefined } : x,
  );
  // In a round trip the start and the return are the same station: change both.
  if (closed && (index === 0 || index === list.length - 1)) {
    const other = index === 0 ? list.length - 1 : 0;
    list[other] = { ...list[other]!, ...stop };
  }
  return withWaypoints(tour, list);
}

/** One control for a station's stay: 0 rides through, anything else gets off for that long. */
export function setStay(tour: Tour, index: number, min: number): Tour {
  const w = tour.waypoints[index];
  if (!w || w.kind === 'start' || w.kind === 'end') return tour;
  if (min <= 0) return setStop(tour, index, false);
  return w.kind === 'via' ? setStop(tour, index, true, min) : setDwell(tour, index, min);
}
