import type { Trip } from '../core/trip';
import { savedList } from './listStore';

/** Saved trips (`srr.trips.v1`), shared by every tab. */
export const tripsList = savedList<Trip>('srr.trips.v1', (raw) =>
  Array.isArray(raw)
    ? (raw as Trip[]).filter((t) => t && typeof t.id === 'string' && !!t.route)
    : [],
);
