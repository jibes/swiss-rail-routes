import { create } from 'zustand';
import type { Waypoint } from '../core/model';

/**
 * Adding on the map (0.32.0): the trip's own map shows, from one of its stations, every place
 * the trains from there reach without a change; a tap adds one after it, and the web goes on
 * from the stop added. One state for the trip screen (which starts it) and the map (which
 * shows it, beside the trip or on its own screen).
 */
export interface MapAdd {
  trip: string;
  /** The entry the next stop goes after. */
  after: number;
  /** Where the web starts and when you leave it, local `YYYY-MM-DDTHH:MM`. */
  from: Pick<Waypoint, 'stopRef' | 'name'>;
  at: string;
}

export const useMapAdd = create<{
  add: MapAdd | null;
  start: (a: MapAdd) => void;
  stop: () => void;
}>((set) => ({
  add: null,
  start: (add) => set({ add }),
  stop: () => set({ add: null }),
}));
