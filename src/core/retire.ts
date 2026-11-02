// A trip whose day is over leaves the list and waits in search as one of your trips (SPEC §3a,
// 0.4.0): its stations, stays and lines, without times. The same stations twice are one entry.
import { markRings, routeKey } from './line';
import type { Tour } from './model';
import { dayOf, tripStatus, type ArrivalOf, type Trip } from './trip';

export interface Retired {
  trips: Trip[];
  tours: Tour[];
  /** True when anything moved. */
  changed: boolean;
}

export function retire(
  trips: Trip[],
  tours: Tour[],
  now: number,
  arrivalOf: ArrivalOf = () => undefined,
): Retired {
  // Its day over (in Zurich) and the trip over, delays counted: a late last train keeps it.
  const today = dayOf(now);
  const past = trips.filter(
    (t) => t.route.date < today && tripStatus(t, now, arrivalOf(t)) === 'past',
  );
  if (!past.length) return { trips, tours, changed: false };
  let list = [...tours];
  // Oldest first, so the most recent ends up on top.
  for (const t of [...past].sort((a, b) => a.route.date.localeCompare(b.route.date))) {
    if (t.route.waypoints.length < 2) continue;
    const tour: Tour = {
      ...structuredClone(t.route),
      // The same id on every device that retires it, so sync makes them one.
      id: `past-${t.id}`,
      name: t.name,
      waypoints: markRings(t.route.waypoints),
    };
    const key = routeKey(tour);
    list = [tour, ...list.filter((x) => routeKey(x) !== key)];
  }
  const gone = new Set(past.map((t) => t.id));
  return { trips: trips.filter((t) => !gone.has(t.id)), tours: list, changed: true };
}
