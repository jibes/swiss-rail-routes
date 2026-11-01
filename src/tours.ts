// Tours in memory, persisted to IndexedDB on every change (debounced).
import { create } from 'zustand';
import { newTour } from './core/edit';
import type { Tour } from './core/model';
import { loadTours, saveTours } from './io/tours';

interface ToursState {
  loaded: boolean;
  tours: Tour[];
  load: () => Promise<void>;
  create: (tour?: Omit<Tour, 'id'>) => string;
  update: (id: string, edit: (t: Tour) => Tour) => void;
  remove: (id: string) => void;
  /** Everything at once, saved at once (sync). */
  replaceAll: (list: Tour[]) => void;
}

const newId = () => crypto.randomUUID();

/** Next Saturday, or today when it is one: day trips are mostly planned for the weekend. */
export function defaultDate(now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return d.toLocaleDateString('sv-SE');
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
const persistNow = (list: Parameters<typeof saveTours>[0]) => {
  pending = () => saveTours(list);
  return flush();
};
const persist = (tours: Tour[]) => {
  clearTimeout(timer);
  pending = () => saveTours(tours);
  timer = setTimeout(() => void flush(), 300);
};

export const useTours = create<ToursState>()((set, get) => ({
  loaded: false,
  tours: [],
  load: async () => {
    if (get().loaded) return;
    set({ tours: await loadTours(), loaded: true });
  },
  create: (tour) => {
    const id = newId();
    const t: Tour = tour ? { ...tour, id } : newTour(id, defaultDate());
    const tours = [t, ...get().tours];
    set({ tours });
    void persistNow(tours);
    return id;
  },
  update: (id, edit) => {
    const tours = get().tours.map((t) => (t.id === id ? edit(t) : t));
    set({ tours });
    persist(tours);
  },
  remove: (id) => {
    const tours = get().tours.filter((t) => t.id !== id);
    set({ tours });
    void persistNow(tours);
  },
  replaceAll: (tours) => {
    set({ tours });
    void persistNow(tours);
  },
}));
