// Your past trips (code: tours) in memory, saved item by item (src/io/listStore.ts).
import { create } from 'zustand';
import type { Tour } from './core/model';
import { log } from './io/log';
import { toursList } from './io/tours';

interface ToursState {
  loaded: boolean;
  /** The saved past trips could not be read: nothing is saved or synced this visit. */
  failed: boolean;
  tours: Tour[];
  load: () => Promise<void>;
  remove: (id: string) => void;
  /** Everything at once (sync, retiring, search): saved at once, item by item. */
  replaceAll: (list: Tour[]) => Promise<unknown>;
}

/** Next Saturday, or today when it is one: day trips are mostly planned for the weekend. */
export function defaultDate(now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return d.toLocaleDateString('sv-SE');
}

export const useTours = create<ToursState>()((set, get) => ({
  loaded: false,
  failed: false,
  tours: [],
  load: async () => {
    if (get().loaded) return;
    try {
      const tours = await toursList.load();
      log('pastTrips.load', { count: tours.length });
      set({ tours, loaded: true });
    } catch {
      set({ loaded: true, failed: true });
    }
  },
  remove: (id) => {
    log('pastTrip.remove', { id });
    const before = get().tours;
    const tours = before.filter((t) => t.id !== id);
    set({ tours });
    void toursList.save(before, tours, true);
  },
  replaceAll: (tours) => {
    log('pastTrips.replaceAll', { count: tours.length });
    const before = get().tours;
    set({ tours });
    return toursList.save(before, tours, true);
  },
}));

toursList.onOtherTab((tours) => useTours.setState({ tours }));
