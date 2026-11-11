// One object (0.52.0): the routes kept as "your trips" before (a trip whose day was over left the
// list) come back as trips, once (`tripsFromTours`). Run by App once the lists are read and sync
// has settled. Items this version cannot read (held) stay as they came, in both lists, and of the
// tours only those read here go, not one that came in meanwhile (review of 11 Nov 2026: held
// items were dropped, and their deletion synced to the device that wrote them).
import type { Tour } from '../core/model';
import { tripsFromTours } from '../core/pastTrips';
import type { Trip } from '../core/trip';
import { useTours } from '../tours';
import { useTrips } from '../trips';
import { log } from './log';
import { toursList } from './tours';
import { tripsList } from './trips';

export async function migratePastTrips(now = new Date()): Promise<void> {
  const tours = useTours.getState().tours;
  // Lists that could not be read are never written.
  if (!tours.length || useTrips.getState().failed || useTours.getState().failed) return;
  const trips = useTrips.getState().trips;
  const back = tripsFromTours(tours, trips, now);
  const done = new Set(tours.map((x) => x.id));
  log('pastTrips.migrate', { tours: tours.length, trips: back.length });
  await useTrips.getState().replaceAll([...trips, ...back, ...(tripsList.held() as Trip[])]);
  await useTours
    .getState()
    .replaceAll([
      ...useTours.getState().tours.filter((x) => !done.has(x.id)),
      ...(toursList.held() as Tour[]),
    ]);
}
