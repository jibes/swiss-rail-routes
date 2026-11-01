// Saved trips in memory, persisted to IndexedDB on every change (debounced).
import { create } from 'zustand';
import type { Trip } from './core/trip';
import { loadTrips, saveTrips } from './io/trips';

interface TripsState {
  loaded: boolean;
  trips: Trip[];
  load: () => Promise<void>;
  add: (t: Trip) => void;
  update: (id: string, edit: (t: Trip) => Trip) => void;
  remove: (id: string) => void;
  /** Everything at once, saved at once (sync). */
  replaceAll: (list: Trip[]) => void;
}

let timer: ReturnType<typeof setTimeout> | undefined;
let pending: (() => Promise<unknown>) | undefined;
/** Edits are saved after 300 ms of quiet; adds and removes, and the page going away, at once. */
const flush = () => {
  clearTimeout(timer);
  const p = pending;
  pending = undefined;
  return p?.();
};
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
}
const persistNow = (list: Parameters<typeof saveTrips>[0]) => {
  pending = () => saveTrips(list);
  return flush();
};
const persist = (trips: Trip[]) => {
  clearTimeout(timer);
  pending = () => saveTrips(trips);
  timer = setTimeout(() => void flush(), 300);
};

export const useTrips = create<TripsState>()((set, get) => ({
  loaded: false,
  trips: [],
  load: async () => {
    if (get().loaded) return;
    set({ trips: await loadTrips(), loaded: true });
  },
  add: (t) => {
    const trips = [t, ...get().trips];
    set({ trips });
    void persistNow(trips);
  },
  update: (id, edit) => {
    const trips = get().trips.map((t) => (t.id === id ? edit(t) : t));
    set({ trips });
    persist(trips);
  },
  remove: (id) => {
    const trips = get().trips.filter((t) => t.id !== id);
    set({ trips });
    void persistNow(trips);
  },
  replaceAll: (trips) => {
    set({ trips });
    void persistNow(trips);
  },
}));
