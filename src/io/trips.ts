import { get, set } from 'idb-keyval';
import type { Trip } from '../core/trip';

const TRIPS = 'srr.trips.v1';

/** Saved trips; storage that cannot be opened (blocked site data) gives none. */
export async function loadTrips(): Promise<Trip[]> {
  try {
    const raw = await get<Trip[]>(TRIPS);
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
export const saveTrips = (trips: Trip[]) => set(TRIPS, trips);
