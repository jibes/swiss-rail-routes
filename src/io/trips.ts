import { get, set } from 'idb-keyval';
import type { Trip } from '../core/trip';

const TRIPS = 'srr.trips.v1';

export const loadTrips = async (): Promise<Trip[]> => (await get<Trip[]>(TRIPS)) ?? [];
export const saveTrips = (trips: Trip[]) => set(TRIPS, trips);
