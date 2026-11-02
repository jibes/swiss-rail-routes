// Saved trips in memory, persisted to IndexedDB on every change (debounced).
import { create } from 'zustand';
import type { Tour } from './core/model';
import type { Trip } from './core/trip';
import { log } from './io/log';
import { loadTrips, saveTrips } from './io/trips';

interface TripsState {
  loaded: boolean;
  trips: Trip[];
  load: () => Promise<void>;
  add: (t: Trip) => void;
  update: (id: string, edit: (t: Trip) => Trip) => void;
  /** Changes the route; its timetable goes and is planned again (usePlanner). */
  editRoute: (id: string, edit: (r: Tour) => Tour) => void;
  remove: (id: string) => void;
  /** Everything at once, saved at once (sync). */
  replaceAll: (list: Trip[]) => Promise<unknown>;
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
    const trips = await loadTrips();
    log('trips.load', { count: trips.length });
    set({ trips, loaded: true });
  },
  add: (t) => {
    log('trip.add', { trip: t.id, date: t.route.date, stops: t.route.waypoints.length });
    const trips = [t, ...get().trips];
    set({ trips });
    void persistNow(trips);
  },
  update: (id, edit) => {
    const trips = get().trips.map((t) => {
      if (t.id !== id) return t;
      const next = edit(t);
      if (next !== t)
        log('trip.update', {
          trip: id,
          changed: (Object.keys(next) as (keyof Trip)[]).filter((k) => next[k] !== t[k]),
          planned: !!next.chain,
        });
      return next;
    });
    set({ trips });
    persist(trips);
  },
  editRoute: (id, edit) => {
    const trips = get().trips.map((t) => {
      if (t.id !== id) return t;
      const route = edit(t.route);
      if (JSON.stringify(route) === JSON.stringify(t.route)) return t;
      const { chain: _c, legs: _l, compact: _p, ...rest } = t;
      log('trip.route', {
        trip: id,
        date: route.date,
        anchor: route.anchor,
        stops: route.waypoints.map((w) => `${w.name}${w.kind === 'stop' ? ` ${w.dwellMin}′` : ''}`),
        hadTimetable: !!t.chain,
      });
      return { ...rest, route };
    });
    set({ trips });
    // A tap, not a keystroke: saved at once.
    void persistNow(trips);
  },
  remove: (id) => {
    log('trip.remove', { trip: id });
    const trips = get().trips.filter((t) => t.id !== id);
    set({ trips });
    void persistNow(trips);
  },
  replaceAll: (trips) => {
    log('trips.replaceAll', { count: trips.length });
    set({ trips });
    return Promise.resolve(persistNow(trips));
  },
}));
