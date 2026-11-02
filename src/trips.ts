// Saved trips in memory, saved item by item to IndexedDB (src/io/listStore.ts): edits after
// 300 ms of quiet, adds and removes at once. Other tabs' saves come in as they happen.
import { create } from 'zustand';
import type { Tour } from './core/model';
import type { Trip } from './core/trip';
import { log } from './io/log';
import { tripsList } from './io/trips';

interface TripsState {
  loaded: boolean;
  /** The saved trips could not be read: nothing is saved or synced this visit. */
  failed: boolean;
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

export const useTrips = create<TripsState>()((set, get) => ({
  loaded: false,
  failed: false,
  trips: [],
  load: async () => {
    if (get().loaded) return;
    try {
      const trips = await tripsList.load();
      log('trips.load', { count: trips.length });
      set({ trips, loaded: true });
    } catch {
      set({ loaded: true, failed: true });
    }
  },
  add: (t) => {
    log('trip.add', { trip: t.id, date: t.route.date, stops: t.route.waypoints.length });
    const before = get().trips;
    const trips = [t, ...before];
    set({ trips });
    void tripsList.save(before, trips, true);
  },
  update: (id, edit) => {
    const before = get().trips;
    const trips = before.map((t) => {
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
    void tripsList.save(before, trips);
  },
  editRoute: (id, edit) => {
    const before = get().trips;
    const trips = before.map((t) => {
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
    void tripsList.save(before, trips, true);
  },
  remove: (id) => {
    log('trip.remove', { trip: id });
    const before = get().trips;
    const trips = before.filter((t) => t.id !== id);
    set({ trips });
    void tripsList.save(before, trips, true);
  },
  replaceAll: (trips) => {
    log('trips.replaceAll', { count: trips.length });
    const before = get().trips;
    set({ trips });
    return tripsList.save(before, trips, true);
  },
}));

/** Resolves once the saved trips are in (at once when they are). */
export const tripsLoaded = () =>
  new Promise<void>((resolve) => {
    if (useTrips.getState().loaded) return resolve();
    const off = useTrips.subscribe((s) => {
      if (!s.loaded) return;
      off();
      resolve();
    });
  });

tripsList.onOtherTab((trips) => {
  log('trips.otherTab', { count: trips.length });
  useTrips.setState({ trips });
});
