// One object (0.52.0): a trip stays a trip, whenever it is. Past trips are the ones over; their
// stations are offered again when adding (the add sheet's "your trips"). Before 0.52.0 a trip
// whose day was over left the list as a route without times (`srr.tours.v1`, code: tours):
// those come back as trips once, by the same id on every device, so sync makes them one.
import { routeKey } from './line';
import type { Tour } from './model';
import { isOver, newTrip, type ArrivalOf, type Trip } from './trip';

/** Past trips' routes for the add sheet, most recent first, the same stations once. */
export function pastRoutes(
  trips: Trip[],
  now: number,
  arrivalOf: ArrivalOf = () => undefined,
): Tour[] {
  const seen = new Set<string>();
  return trips
    .filter((t) => t.route.waypoints.length > 1 && isOver(t, now, arrivalOf(t)))
    .sort((a, b) => b.route.date.localeCompare(a.route.date))
    .flatMap((t) => {
      const key = routeKey(t.route);
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ ...t.route, id: t.id, name: t.name || t.route.name }];
    });
}

/** The routes kept before 0.52.0 as trips, not planned, those already in `trips` left out. */
export function tripsFromTours(tours: Tour[], trips: Trip[], now: Date): Trip[] {
  const have = new Set(trips.map((t) => t.id));
  return tours
    .filter((x) => x.waypoints.length > 1 && !have.has(x.id))
    .map((x) => newTrip(x.id, x, undefined, undefined, now));
}
