// Saved trips in memory, saved item by item to IndexedDB (src/io/listStore.ts): edits after
// 300 ms of quiet, adds and removes at once. Other tabs' saves come in as they happen.
import { create } from 'zustand';
import type { Tour } from './core/model';
import { splitAllNights } from './core/nights';
import { withoutTimetable, type Trip } from './core/trip';
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
  /** A trip planned over a night, made one trip a day (`splitAllNights`): when its plan comes. */
  splitNights: (id: string) => void;
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
      const saved = await tripsList.load();
      // One trip per day of travel (0.64.0): one planned over a night, not yet begun, is split
      // there, once, each part with its share of the timetable (0.64.3: only here, never on a
      // sync or an add, so nothing synced in or edited is regenerated or replaced).
      const trips = splitAllNights(saved, Date.now());
      log('trips.load', { count: trips.length, split: trips.length - saved.length });
      set({ trips, loaded: true });
      if (trips !== saved) void tripsList.save(saved, trips, true).catch(() => undefined);
    } catch {
      set({ loaded: true, failed: true });
    }
  },
  add: (t) => {
    log('trip.add', { trip: t.id, date: t.route.date, stops: t.route.waypoints.length });
    const before = get().trips;
    const trips = [t, ...before];
    set({ trips });
    void tripsList.save(before, trips, true).catch(() => undefined);
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
    void tripsList.save(before, trips).catch(() => undefined);
  },
  editRoute: (id, edit) => {
    const before = get().trips;
    const trips = before.map((t) => {
      if (t.id !== id) return t;
      const route = edit(t.route);
      if (JSON.stringify(route) === JSON.stringify(t.route)) return t;
      log('trip.route', {
        trip: id,
        date: route.date,
        anchor: route.anchor,
        stops: route.waypoints.map((w) => `${w.name}${w.kind === 'stop' ? ` ${w.dwellMin}′` : ''}`),
        hadTimetable: !!t.chain,
      });
      // When you changed it (0.49.0): a trip put in after its time is told by it.
      return { ...withoutTimetable(t), route, editedAt: new Date().toISOString() };
    });
    set({ trips });
    // A tap, not a keystroke: saved at once.
    void tripsList.save(before, trips, true).catch(() => undefined);
  },
  remove: (id) => {
    log('trip.remove', { trip: id });
    const before = get().trips;
    const trips = before.filter((t) => t.id !== id);
    set({ trips });
    void tripsList.save(before, trips, true).catch(() => undefined);
  },
  splitNights: (id) => {
    const before = get().trips;
    const t = before.find((x) => x.id === id);
    if (!t) return;
    const trips = splitAllNights(before, Date.now());
    if (trips === before) return;
    log('trips.split', { trip: id, parts: trips.length - before.length + 1 });
    set({ trips });
    void tripsList.save(before, trips, true).catch(() => undefined);
  },
  replaceAll: (trips) => {
    log('trips.replaceAll', { count: trips.length });
    const before = get().trips;
    // Items this version cannot read stay out of the screens, held and saved as they came.
    const { items, saved } = tripsList.replace(before, trips);
    set({ trips: items });
    return saved;
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

// A failed write stops saving and syncing for this visit, and the list says so.
tripsList.onFailed(() => useTrips.setState({ failed: true }));
