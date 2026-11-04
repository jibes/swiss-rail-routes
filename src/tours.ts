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
    void toursList.save(before, tours, true).catch(() => undefined);
  },
  replaceAll: (tours) => {
    log('pastTrips.replaceAll', { count: tours.length });
    const before = get().tours;
    // Items this version cannot read stay out of the screens, held and saved as they came.
    const { items, saved } = toursList.replace(before, tours);
    set({ tours: items });
    return saved;
  },
}));

toursList.onOtherTab((tours) => useTours.setState({ tours }));

// A failed write stops saving and syncing for this visit, and the list says so.
toursList.onFailed(() => useTours.setState({ failed: true }));
