// The stations you entered lately, kept on this device (`srr.recentStops.v1`, 0.48.0).
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { KEYS } from '../core/keys';
import { remember, type RecentStop } from '../core/recentStops';

interface Recent {
  stops: RecentStop[];
  /** Stations just added to a trip: put first. */
  add: (stops: RecentStop[]) => void;
}

export const useRecentStops = create<Recent>()(
  persist(
    (set) => ({
      stops: [],
      add: (stops) => stops.length && set((s) => ({ stops: remember(s.stops, stops) })),
    }),
    { name: KEYS.recentStops, version: 1 },
  ),
);
