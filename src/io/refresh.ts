// A trip's trains asked again (core/refresh.ts): past the device's own answers, as this is what
// asking for the latest means. Its links too need the station list.
import { encodeTripLink } from '../core/export/tripLink';
import { refreshChain, chainWarnings, type Refreshed } from '../core/refresh';
import { stopKey } from '../core/stops';
import { dayOf, type PlannedTrip } from '../core/trip';
import { GA, TEMPLATES } from '../data';
import { fetchTrips } from './ojp';
import { log } from './log';
import { stopSearch } from './stops';

/** The app's name of a stop; none (so the link names it) if the list cannot be read. */
export async function stopNames() {
  try {
    const index = await stopSearch();
    return (ref: string) => index.byRef(stopKey(ref))?.name;
  } catch {
    return () => undefined;
  }
}

export async function reloadTrip(trip: PlannedTrip): Promise<Refreshed> {
  const t0 = performance.now();
  const index = await stopSearch();
  const out = await refreshChain(trip, {
    ask: (q) => fetchTrips(q),
    templates: TEMPLATES,
    ga: GA,
    stop: (ref) => index.byRef(ref),
    today: dayOf(Date.now()),
  });
  const { rides, found, gone, failed } = out;
  log('trip.reload', { trip: trip.id, rides, found, gone, failed, ms: performance.now() - t0 });
  return out;
}

/** What a link's trip warns of before anything was asked (ticket, daylight, tight changes). */
export async function linkWarnings(trip: PlannedTrip) {
  const index = await stopSearch();
  return chainWarnings(trip, trip.chain.connections, {
    templates: TEMPLATES,
    ga: GA,
    stop: (ref) => index.byRef(ref),
  });
}

export const shareHash = async (trip: PlannedTrip) => encodeTripLink(trip, await stopNames());
