// The stations you entered lately (`srr.recentStops.v1`, 0.48.0), synced with your trips (0.48.1).
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
      add: (stops) => stops.length && set((s) => ({ stops: remember(s.stops, stops, Date.now()) })),
    }),
    {
      name: KEYS.recentStops,
      version: 2,
      // 0.48.0 kept no pick times: the order stays, as picks a millisecond apart, the oldest
      // of all (any pick on another device since is newer).
      migrate: (old, from) => {
        const stops = ((old as { stops?: RecentStop[] })?.stops ?? []).map((s, i, all) => ({
          ...s,
          at: from < 2 ? all.length - i : (s.at ?? 0),
        }));
        return { stops } as Recent;
      },
    },
  ),
);
