import type { Leg, Tour, Waypoint } from './model';

/** Waypoints where the traveller gets off; every leg ends at one of these. */
const isBreak = (w: Waypoint) => w.kind !== 'via';

export function isRoundTrip(tour: Tour): boolean {
  const first = tour.waypoints[0];
  const last = tour.waypoints.at(-1);
  return tour.waypoints.length > 1 && !!first && !!last && first.stopRef === last.stopRef;
}

/** Splits a tour into legs at every non-via waypoint (SPEC §5 step 1). */
export function expandLegs(tour: Tour): Leg[] {
  const legs: Leg[] = [];
  let from: Waypoint | undefined;
  let vias: Waypoint[] = [];
  for (const w of tour.waypoints) {
    if (!from) {
      from = w;
      continue;
    }
    if (!isBreak(w)) {
      vias.push(w);
      continue;
    }
    legs.push({ index: legs.length, from, to: w, vias });
    from = w;
    vias = [];
  }
  return legs;
}

/** Total planned dwell, in minutes, at stops and turnarounds. */
export function totalDwellMin(tour: Tour): number {
  return tour.waypoints.reduce(
    (sum, w) => sum + (w.kind === 'stop' || w.kind === 'turnaround' ? w.dwellMin : 0),
    0,
  );
}
